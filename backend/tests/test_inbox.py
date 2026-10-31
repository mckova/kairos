"""Inbox notifications, @mentions, "my work", global search, and the personal AI features."""
import json

from app.ai import client as ai
from conftest import signup
from test_ai import FakeClaude, text


def _team(ctx):
    c, h = ctx["c"], ctx["h"]
    hb, bob = signup(c, "bob@x.io", "Bob Stone")
    c.post(f"/api/workspaces/{ctx['ws']['id']}/members", json={"email": "bob@x.io"}, headers=h)
    return hb, bob


def test_assign_mention_comment_and_status_notify(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    hb, bob = _team(ctx)
    t = c.post(f"{b}/tasks", json={"title": "Ship API", "assignee_id": bob["id"]}, headers=h).json()
    inbox = c.get("/api/me/notifications", headers=hb).json()
    assert inbox["unread"] == 1 and inbox["items"][0]["kind"] == "assigned" and inbox["items"][0]["task_key"] == t["key"]

    # Bob mentions Alice by first name: Alice gets a mention, Bob (the actor) gets nothing
    c.post(f"{b}/tasks/{t['id']}/comments", json={"body": "@alice can you review?"}, headers=hb)
    mine = c.get("/api/me/notifications", headers=h).json()
    assert [n["kind"] for n in mine["items"]] == ["mentioned"]
    assert c.get("/api/me/notifications", headers=hb).json()["unread"] == 1

    # Alice comments without a mention: assignee (Bob) is told, Alice is not
    c.post(f"{b}/tasks/{t['id']}/comments", json={"body": "looks good"}, headers=h)
    kinds = [n["kind"] for n in c.get("/api/me/notifications", headers=hb).json()["items"]]
    assert kinds[0] == "commented"

    # Alice moves it: assignee hears about the status change
    c.patch(f"{b}/tasks/{t['id']}", json={"state_id": ctx["states"]["Done"]}, headers=h)
    top = c.get("/api/me/notifications", headers=hb).json()["items"][0]
    assert top["kind"] == "status" and "Done" in top["text"]

    # mark one, then all, as read
    first = top["id"]
    assert c.post("/api/me/notifications/read", json={"ids": [first]}, headers=hb).json()["marked"] == 1
    assert c.post("/api/me/notifications/read", json={}, headers=hb).json()["marked"] == 2
    assert c.get("/api/me/notifications", headers=hb).json()["unread"] == 0


def test_mentions_ignore_non_members(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    hx, _ = signup(c, "carol@x.io", "Carol")  # not in the workspace
    t = c.post(f"{b}/tasks", json={"title": "X", "description": "ping @carol"}, headers=h).json()
    assert t["id"] and c.get("/api/me/notifications", headers=hx).json()["unread"] == 0


def test_my_tasks_and_search(ctx):
    c, b, h, me = ctx["c"], ctx["base"], ctx["h"], ctx["user"]
    a = c.post(f"{b}/tasks", json={"title": "Write release notes", "assignee_id": me["id"], "due_date": "2020-01-01"}, headers=h).json()
    blk = c.post(f"{b}/tasks", json={"title": "Fix login bug", "assignee_id": me["id"]}, headers=h).json()
    c.post(f"{b}/tasks", json={"title": "Done one", "assignee_id": me["id"], "state_id": ctx["states"]["Done"]}, headers=h)
    c.post(f"{b}/dependencies", json={"blocker_id": a["id"], "blocked_id": blk["id"]}, headers=h)
    mine = c.get("/api/me/tasks", headers=h).json()
    assert [t["key"] for t in mine] == [a["key"], blk["key"]]
    assert mine[0]["overdue"] and mine[1]["blocked"] and mine[0]["project_name"] == "Apollo"

    assert [x["key"] for x in c.get("/api/search?q=release notes", headers=h).json()] == [a["key"]]
    assert [x["key"] for x in c.get(f"/api/search?q={blk['key'].lower()}", headers=h).json()] == [blk["key"]]
    # other users cannot find tasks in workspaces they are not in
    hx, _ = signup(c, "eve@x.io", "Eve")
    assert c.get("/api/search?q=release", headers=hx).json() == []


def test_plan_my_day(ctx):
    c, b, h, me = ctx["c"], ctx["base"], ctx["h"], ctx["user"]
    t = c.post(f"{b}/tasks", json={"title": "Write release notes", "assignee_id": me["id"]}, headers=h).json()
    plan = {"headline": "One task today.", "focus": [{"task_id": t["id"], "reason": "due soon"}, {"task_id": 999, "reason": "x"}],
            "heads_up": [], "inbox_summary": ""}
    f = FakeClaude([text(json.dumps(plan))])
    ai.set_client(f)
    try:
        r = c.post("/api/me/ai/plan", headers=h).json()
    finally:
        ai.set_client(None)
    assert [x["key"] for x in r["focus"]] == [t["key"]]  # invented ids are dropped
    req = f.requests[0]
    assert req["output_config"]["format"]["type"] == "json_schema" and "Write release notes" in req["messages"][0]["content"]


def test_triage_suggests_owner_and_duplicates(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    _, bob = _team(ctx)
    old = c.post(f"{b}/tasks", json={"title": "Add dark mode"}, headers=h).json()
    out = {"priority": "medium", "estimate": 3, "label_names": ["Bug", "nope"], "assignee_id": bob["id"],
           "assignee_reason": "has spare capacity", "duplicates": [{"task_id": old["id"], "reason": "same feature"},
                                                                    {"task_id": 4242, "reason": "invented"}], "rationale": "r"}
    ai.set_client(FakeClaude([text(json.dumps(out))]))
    try:
        r = c.post(f"{b}/ai/triage", json={"title": "Dark theme support"}, headers=h).json()
    finally:
        ai.set_client(None)
    assert r["assignee_id"] == bob["id"] and r["estimate"] == 3
    assert [d["key"] for d in r["duplicates"]] == [old["key"]]
    labels = {l["name"]: l["id"] for l in ctx["p"]["labels"]}
    assert r["label_ids"] == ([labels["Bug"]] if "Bug" in labels else [])


def test_personal_socket_receives_notifications(ctx):
    c, b, h = ctx["c"], ctx["base"], ctx["h"]
    hb, bob = _team(ctx)
    token = hb["Authorization"].split()[1]
    with c.websocket_connect(f"/ws/me?token={token}") as ws:
        c.post(f"{b}/tasks", json={"title": "Ping", "assignee_id": bob["id"]}, headers=h)
        msg = ws.receive_json()
        assert msg["event"] == "notification.created" and "assigned you" in msg["data"]["text"]
