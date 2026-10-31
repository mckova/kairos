"""AI features: the project copilot agent, task breakdown, natural-language task
capture and sprint status reports. All run on Claude (see ai/client.py)."""
from __future__ import annotations

import json
from datetime import date

from sqlalchemy.orm import Session

from ..models import Project, Sprint, SprintStatus, Task, TaskActivity, User
from ..routers import analytics as an
from . import client as ai
from .tools import TOOLS, WRITE_TOOLS, Toolbox

MAX_TURNS = 12

COPILOT_SYSTEM = """You are Kairos Copilot, the AI teammate inside the Kairos project management app.
You work on one project on behalf of the signed-in user, with exactly their permissions.

How to work:
- Use the tools to read real data before answering; never invent task keys, people or numbers.
- Call project_overview when you need member, sprint or state ids.
- When the user asks for a change, make it with the write tools, then say what you changed using task keys (e.g. PLS-12).
- For planning questions (risk, deadlines, capacity, what to do next) use get_analytics and explain the reasoning briefly.
- If a request is ambiguous and a wrong change would be costly (reassigning many tasks, moving due dates), state your assumption and do the safe part, or ask one short question.
- Answer in the user's language. Keep replies short: a few sentences or a compact list."""


def _context(project: Project, user: User) -> str:
    return f"Today is {date.today().isoformat()} ({date.today():%A}). Project: {project.name} (key {project.key}). Signed-in user: {user.name} (id {user.id})."


def run_copilot(db: Session, user: User, project: Project, history: list[dict]) -> dict:
    """Agentic tool loop. `history` is the visible chat so far: [{role, content}], last one from the user."""
    box = Toolbox(db, user, project)
    messages: list = [{"role": m["role"], "content": m["content"]} for m in history]
    actions: list[dict] = []
    for _ in range(MAX_TURNS):
        response = ai.create(
            max_tokens=16000,
            system=[{"type": "text", "text": COPILOT_SYSTEM}, {"type": "text", "text": _context(project, user)}],
            tools=TOOLS,
            output_config={"effort": "medium"},
            messages=messages,
        )
        ai.check_stop(response)
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "pause_turn":
            continue
        calls = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        if not calls:
            return {"reply": ai.text_of(response) or "Done.", "actions": actions}
        results = []
        for call in calls:
            content, is_error = box.run(call.name, call.input)
            if call.name in WRITE_TOOLS or is_error:
                actions.append({"tool": call.name, "input": call.input, "ok": not is_error, "result": content[:300]})
            results.append({"type": "tool_result", "tool_use_id": call.id, "content": content, **({"is_error": True} if is_error else {})})
        messages.append({"role": "user", "content": results})
    return {"reply": "I stopped after too many steps - try a narrower request.", "actions": actions}


# ---- task breakdown -------------------------------------------------------------
BREAKDOWN_SCHEMA = {
    "type": "object",
    "properties": {
        "rationale": {"type": "string"},
        "subtasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "estimate": {"type": "number"},
                    "priority": {"type": "string", "enum": ["none", "low", "medium", "high", "urgent"]},
                    "depends_on": {"type": "array", "items": {"type": "integer"}, "description": "0-based indexes of earlier subtasks"},
                },
                "required": ["title", "description", "estimate", "priority", "depends_on"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["rationale", "subtasks"],
    "additionalProperties": False,
}


def breakdown(db: Session, user: User, project: Project, task: Task) -> dict:
    siblings = [t.title for t in db.query(Task).filter_by(project_id=project.id).limit(60)]
    prompt = (
        f"Break this task into 3-8 concrete subtasks that one engineer could each finish in 0.5-5 days.\n"
        f"Estimate in story points from the scale 0.5, 1, 2, 3, 5, 8. List subtasks in a sensible order and use "
        f"depends_on for real finish-to-start dependencies only (indexes must point to earlier subtasks).\n\n"
        f"Project: {project.name} - {project.description}\n"
        f"Task {task.key}: {task.title}\nPriority: {task.priority.value}\nDescription:\n{task.description or '(none)'}\n\n"
        f"Other task titles in the project, for context (avoid duplicating them):\n- " + "\n- ".join(siblings)
    )
    response = ai.create(
        max_tokens=16000,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": BREAKDOWN_SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    ai.check_stop(response)
    data = json.loads(ai.text_of(response))
    for i, s in enumerate(data["subtasks"]):
        s["depends_on"] = sorted({d for d in s.get("depends_on", []) if isinstance(d, int) and 0 <= d < i})
    return data


# ---- natural-language capture -------------------------------------------------------
def parse_task(project: Project, members: list[dict], sprints: list[dict], text: str) -> dict:
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "priority": {"type": "string", "enum": ["none", "low", "medium", "high", "urgent"]},
            "assignee_id": {"type": ["integer", "null"]},
            "estimate": {"type": ["number", "null"]},
            "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            "sprint_id": {"type": ["integer", "null"]},
            "label_names": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["title", "description", "priority", "assignee_id", "estimate", "due_date", "sprint_id", "label_names"],
        "additionalProperties": False,
    }
    prompt = (
        f"Turn the user's note into a task for project {project.name}. Today is {date.today().isoformat()} ({date.today():%A}). "
        f"Resolve relative dates. Only set assignee/sprint/labels when the note implies them; otherwise null/empty. "
        f"Write a clear imperative title (max 80 chars) and keep any extra detail in the description.\n"
        f"Members: {json.dumps(members)}\nSprints: {json.dumps(sprints)}\nLabels: {[l.name for l in project.labels]}\n\n"
        f"Note: {text}"
    )
    response = ai.create(
        max_tokens=4000,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
    )
    ai.check_stop(response)
    data = json.loads(ai.text_of(response))
    valid_ids = {m["id"] for m in members}
    if data.get("assignee_id") not in valid_ids:
        data["assignee_id"] = None
    if data.get("sprint_id") not in {s["id"] for s in sprints}:
        data["sprint_id"] = None
    names = {l.name.lower(): l.id for l in project.labels}
    data["label_ids"] = [names[n.lower()] for n in data.pop("label_names", []) if n.lower() in names]
    return data


# ---- status report ----------------------------------------------------------------------
def status_report(db: Session, user: User, project: Project, sprint: Sprint | None) -> str:
    pid = project.id
    facts: dict = {"project": project.name, "today": date.today().isoformat(), "summary": an.summary(pid, None, user, db),
                   "risks": an.risks(pid, None, user, db)["findings"]}
    if sprint:
        facts["sprint"] = {"name": sprint.name, "goal": sprint.goal, "start": str(sprint.start_date), "end": str(sprint.end_date)}
        if sprint.status == SprintStatus.active:
            facts["forecast"] = {k: v for k, v in an.forecast(pid, sprint.id, "sprint", None, user, db).items() if k != "history"}
            facts["workload"] = an.workload(pid, sprint.id, None, user, db)
        facts["burndown_scope"] = an.burndown(pid, sprint.id, None, user, db)["scope"]
    feed = db.query(TaskActivity).filter_by(project_id=pid).order_by(TaskActivity.created_at.desc()).limit(40).all()
    facts["recent_activity"] = [
        f"{a.created_at:%Y-%m-%d} {a.actor.name if a.actor else 'system'} {a.verb} {a.field or ''} {a.new_value or ''} on task#{a.task_id}"
        for a in feed
    ]
    prompt = (
        "Write a status report for stakeholders from these facts. Markdown, under 300 words, sections: "
        "**Headline** (one sentence with an on-track / at-risk / off-track call), **Progress**, **Risks & blockers** "
        "(with the suggested actions), **Next steps**. Use task keys and concrete numbers from the facts only.\n\n"
        + json.dumps(facts, default=str)
    )
    response = ai.create(max_tokens=8000, output_config={"effort": "medium"}, messages=[{"role": "user", "content": prompt}])
    ai.check_stop(response)
    return ai.text_of(response)
