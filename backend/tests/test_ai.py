"""AI layer tests with a scripted fake Claude client (no network, no API key)."""
import json
from types import SimpleNamespace as NS

import pytest

from app.ai import client as ai
from conftest import signup


class FakeClaude:
    """Mimics client.beta.messages.create; returns scripted responses and records requests."""

    def __init__(self, script):
        self.script, self.requests = list(script), []
        self.beta = NS(messages=NS(create=self._create))

    def _create(self, **kw):
        self.requests.append({**kw, "messages": list(kw.get("messages", []))})
        return self.script.pop(0)


def text(t, stop="end_turn"):
    return NS(stop_reason=stop, content=[NS(type="text", text=t)], stop_details=None)


def tool(name, inp, id_="tu_1"):
    return NS(stop_reason="tool_use", content=[NS(type="tool_use", id=id_, name=name, input=inp)], stop_details=None)


@pytest.fixture()
def fake():
    def install(*script):
        f = FakeClaude(script)
        ai.set_client(f)
        return f
    yield install
    ai.set_client(None)


def test_status_and_disabled(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    ai.set_client(None)
    assert c.get("/api/ai/status", headers=h).json()["model"] == "claude-opus-5-5"
    r = c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}, headers=h)
    assert r.status_code in (200, 503)  # 503 when no credentials in the environment


def test_copilot_runs_tools_as_the_user(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    f = fake(
        tool("create_task", {"title": "Write launch post", "priority": "high", "estimate": 2, "status": "In progress"}),
        tool("list_tasks", {"query": "launch"}, "tu_2"),
        text("Created APO-1 and set it in progress."),
    )
    r = c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "add a launch post task"}]}, headers=h).json()
    assert r["reply"].startswith("Created APO-1")
    assert r["actions"][0]["tool"] == "create_task" and r["actions"][0]["ok"]
    t = c.get(f"{b}/tasks", headers=h).json()[0]
    assert (t["title"], t["priority"], t["estimate"], t["state_id"]) == ("Write launch post", "high", 2, ctx["states"]["In progress"])
    # tool results went back to the model, request used the latest model + fallbacks
    second = f.requests[1]
    assert second["model"] == "claude-opus-5-5" and second["fallbacks"] == "default"
    tr = second["messages"][-1]["content"][0]
    assert tr["type"] == "tool_result" and "Created APO-1" in tr["content"]
    third = f.requests[2]["messages"][-1]["content"][0]
    assert "APO-1" in third["content"] and "Write launch post" in third["content"]


def test_copilot_reports_tool_errors_to_model(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    f = fake(tool("update_task", {"key": "APO-99", "priority": "low"}), text("APO-99 does not exist."))
    r = c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "lower APO-99"}]}, headers=h).json()
    assert r["actions"][0]["ok"] is False
    tr = f.requests[1]["messages"][-1]["content"][0]
    assert tr["is_error"] is True and "No task APO-99" in tr["content"]


def test_copilot_respects_viewer_role(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    hv, _ = signup(c, "view@x.io", "Viewer")
    c.post(f"/api/workspaces/{ctx['ws']['id']}/members", json={"email": "view@x.io", "role": "viewer"}, headers=h)
    f = fake(tool("create_task", {"title": "sneaky"}), text("I can't create tasks with your role."))
    r = c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "create a task"}]}, headers=hv).json()
    assert r["actions"][0]["ok"] is False and "403" in f.requests[1]["messages"][-1]["content"][0]["content"]
    assert c.get(f"{b}/tasks", headers=h).json() == []


def test_copilot_analytics_tool(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    f = fake(tool("get_analytics", {"kind": "summary"}), text("All quiet."))
    c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "how are we doing?"}]}, headers=h)
    payload = json.loads(f.requests[1]["messages"][-1]["content"][0]["content"])
    assert "completion" in payload


def test_refusal_becomes_503(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    fake(NS(stop_reason="refusal", content=[], stop_details=NS(explanation="nope")))
    r = c.post(f"{b}/ai/chat", json={"messages": [{"role": "user", "content": "x"}]}, headers=h)
    assert r.status_code == 503 and "declined" in r.json()["detail"]


def test_breakdown_propose_and_apply(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    parent = c.post(f"{b}/tasks", json={"title": "Payments"}, headers=h).json()
    proposal = {"rationale": "split by layer", "subtasks": [
        {"title": "Schema", "description": "", "estimate": 2, "priority": "high", "depends_on": []},
        {"title": "API", "description": "", "estimate": 3, "priority": "high", "depends_on": [0, 5]},
        {"title": "UI", "description": "", "estimate": 3, "priority": "medium", "depends_on": [1]},
    ]}
    f = fake(text(json.dumps(proposal)))
    got = c.post(f"{b}/ai/breakdown", json={"task_id": parent["id"]}, headers=h).json()
    assert got["subtasks"][1]["depends_on"] == [0]  # out-of-range index dropped
    assert f.requests[0]["output_config"]["format"]["type"] == "json_schema"
    made = c.post(f"{b}/ai/breakdown/apply", json={"task_id": parent["id"], "subtasks": got["subtasks"]}, headers=h).json()
    assert [t["key"] for t in made] == ["APO-2", "APO-3", "APO-4"]
    assert all(t["parent_id"] == parent["id"] for t in made)
    assert made[1]["blocked_by"] == [made[0]["id"]] and made[2]["blocked_by"] == [made[1]["id"]]


def test_parse_task_sanitizes_ids(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    c.post(f"{b}/labels", json={"name": "Bug"}, headers=h)
    fake(text(json.dumps({"title": "Fix login", "description": "", "priority": "urgent", "assignee_id": 999,
                          "estimate": 2, "due_date": "2026-11-06", "sprint_id": None, "label_names": ["bug", "Nope"]})))
    r = c.post(f"{b}/ai/parse-task", json={"text": "login broken, urgent, by friday"}, headers=h).json()
    assert r["assignee_id"] is None and r["priority"] == "urgent" and len(r["label_ids"]) == 1


def test_status_report(ctx, fake):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    f = fake(text("**Headline**: on track"))
    r = c.post(f"{b}/ai/report", json={}, headers=h).json()
    assert r["markdown"].startswith("**Headline**")
    assert "summary" in f.requests[0]["messages"][0]["content"]
