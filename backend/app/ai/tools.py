"""Tools the project copilot can call.

Every tool runs through the same router functions the REST API uses, as the
signed-in user, so the agent gets exactly the user's permissions, validation,
audit trail and real-time broadcast. Nothing here bypasses the API layer.
"""
from __future__ import annotations

import json
from datetime import date

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models import Membership, Project, Sprint, Task, User
from ..routers import analytics as an
from ..routers import tasks as tk
from ..schemas import CommentIn, DependencyIn, TaskIn, TaskPatch

PRIORITIES = ["none", "low", "medium", "high", "urgent"]

_task_fields = {
    "title": {"type": "string"},
    "description": {"type": "string", "description": "Markdown"},
    "priority": {"type": "string", "enum": PRIORITIES},
    "assignee_id": {"type": ["integer", "null"], "description": "User id from project_overview, null to unassign"},
    "estimate": {"type": ["number", "null"], "description": "Story points (0.5, 1, 2, 3, 5, 8, 13)"},
    "status": {"type": "string", "description": "State name, e.g. 'In progress'"},
    "sprint_id": {"type": ["integer", "null"], "description": "Sprint id from project_overview, null for backlog"},
    "start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
    "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
    "parent_key": {"type": ["string", "null"], "description": "Key of the parent task, e.g. PLS-3"},
}

TOOLS = [
    {
        "name": "project_overview",
        "description": "Get the project's members (ids, names, weekly capacity), states, labels and sprints. Call this first when you need ids.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "list_tasks",
        "description": "List tasks, optionally filtered. Returns one line per task: key, title, status, priority, assignee, points, sprint, due date, blockers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "State name filter"},
                "assignee_id": {"type": "integer", "description": "0 = unassigned"},
                "sprint_id": {"type": "integer", "description": "0 = backlog (no sprint)"},
                "priority": {"type": "string", "enum": PRIORITIES},
                "query": {"type": "string", "description": "Text search in title/description"},
                "include_done": {"type": "boolean", "description": "Include completed/cancelled tasks (default false)"},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_task",
        "description": "Full details of one task including description, dependencies and recent comments.",
        "input_schema": {
            "type": "object",
            "properties": {"key": {"type": "string", "description": "Task key such as PLS-12"}},
            "required": ["key"],
            "additionalProperties": False,
        },
    },
    {
        "name": "create_task",
        "description": "Create a task. Only `title` is required.",
        "input_schema": {"type": "object", "properties": _task_fields, "required": ["title"], "additionalProperties": False},
    },
    {
        "name": "update_task",
        "description": "Change fields of an existing task. Send only the fields to change.",
        "input_schema": {
            "type": "object",
            "properties": {"key": {"type": "string"}, **_task_fields},
            "required": ["key"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_dependency",
        "description": "Record that `blocker_key` must finish before `blocked_key` can start. Circular dependencies are rejected.",
        "input_schema": {
            "type": "object",
            "properties": {"blocker_key": {"type": "string"}, "blocked_key": {"type": "string"}},
            "required": ["blocker_key", "blocked_key"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_comment",
        "description": "Post a comment on a task (signed as the current user).",
        "input_schema": {
            "type": "object",
            "properties": {"key": {"type": "string"}, "body": {"type": "string"}},
            "required": ["key", "body"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_analytics",
        "description": (
            "Planning analytics. kind: summary (completion, throughput, lead time), risks (ranked risk radar with "
            "suggested actions), forecast (Monte Carlo on-time probability for the active sprint), critical_path "
            "(CPM chain and projected finish), workload (open points vs capacity per person), burndown."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"kind": {"type": "string", "enum": ["summary", "risks", "forecast", "critical_path", "workload", "burndown"]}},
            "required": ["kind"],
            "additionalProperties": False,
        },
    },
]

WRITE_TOOLS = {"create_task", "update_task", "add_dependency", "add_comment"}


class ToolError(Exception):
    pass


class Toolbox:
    def __init__(self, db: Session, user: User, project: Project):
        self.db, self.user, self.project = db, user, project

    # ---- helpers -------------------------------------------------------------
    def _task(self, key: str) -> Task:
        k = key.strip().upper()
        num = k.removeprefix(f"{self.project.key}-")
        if not num.isdigit():
            raise ToolError(f"'{key}' is not a task key of this project ({self.project.key}-<number>)")
        t = self.db.query(Task).filter_by(project_id=self.project.id, number=int(num)).one_or_none()
        if t is None:
            raise ToolError(f"No task {k}")
        return t

    def _state_id(self, name: str) -> int:
        for s in self.project.states:
            if s.name.lower() == name.strip().lower():
                return s.id
        raise ToolError(f"Unknown status '{name}'. Valid: {', '.join(s.name for s in self.project.states)}")

    def _fields(self, inp: dict) -> dict:
        data = {k: v for k, v in inp.items() if k != "key"}
        if "status" in data:
            data["state_id"] = self._state_id(data.pop("status"))
        if "parent_key" in data:
            pk = data.pop("parent_key")
            data["parent_id"] = self._task(pk).id if pk else None
        for d in ("start_date", "due_date"):
            if data.get(d):
                data[d] = date.fromisoformat(data[d])
        return data

    def _line(self, t: Task, users: dict, blocked_by: dict) -> str:
        bits = [t.key, f'"{t.title}"', t.state.name, t.priority.value,
                users.get(t.assignee_id, "unassigned"), f"{t.estimate:g}pts" if t.estimate is not None else "unestimated"]
        if t.sprint_id:
            bits.append(f"sprint#{t.sprint_id}")
        if t.due_date:
            bits.append(f"due {t.due_date}")
        if blocked_by.get(t.id):
            keys = [self.db.get(Task, b).key for b in blocked_by[t.id]]
            bits.append("blocked by " + ",".join(keys))
        return " | ".join(bits)

    def _users(self) -> dict:
        return {m.user_id: m.user.name for m in self.db.query(Membership).filter_by(workspace_id=self.project.workspace_id)}

    # ---- tools -----------------------------------------------------------------
    def project_overview(self) -> str:
        members = self.db.query(Membership).filter_by(workspace_id=self.project.workspace_id).all()
        sprints = self.db.query(Sprint).filter_by(project_id=self.project.id).order_by(Sprint.start_date).all()
        return json.dumps({
            "project": {"name": self.project.name, "key": self.project.key, "description": self.project.description},
            "members": [{"id": m.user_id, "name": m.user.name, "role": m.role.value, "weekly_capacity_points": m.weekly_capacity} for m in members],
            "states": [{"name": s.name, "group": s.group.value, "wip_limit": s.wip_limit} for s in self.project.states],
            "labels": [l.name for l in self.project.labels],
            "sprints": [{"id": s.id, "name": s.name, "status": s.status.value, "start": str(s.start_date), "end": str(s.end_date), "goal": s.goal} for s in sprints],
        })

    def list_tasks(self, status=None, assignee_id=None, sprint_id=None, priority=None, query=None, include_done=False) -> str:
        q = self.db.query(Task).filter(Task.project_id == self.project.id, Task.archived.is_(False))
        if status:
            q = q.filter(Task.state_id == self._state_id(status))
        if assignee_id is not None:
            q = q.filter(Task.assignee_id == (assignee_id or None))
        if sprint_id is not None:
            q = q.filter(Task.sprint_id == (sprint_id or None))
        if priority:
            q = q.filter(Task.priority == priority)
        if query:
            q = q.filter(Task.title.ilike(f"%{query}%") | Task.description.ilike(f"%{query}%"))
        tasks = q.order_by(Task.number).all()
        if not include_done and not status:
            tasks = [t for t in tasks if t.state.group.value not in ("completed", "cancelled")]
        users, (blocked_by, _) = self._users(), tk._deps(self.db, self.project.id)
        lines = [self._line(t, users, blocked_by) for t in tasks[:150]]
        return f"{len(tasks)} task(s)\n" + "\n".join(lines) if lines else "No matching tasks."

    def get_task(self, key: str) -> str:
        t = self._task(key)
        users, (blocked_by, blocks) = self._users(), tk._deps(self.db, self.project.id)
        comments = [f"{c.author.name}: {c.body}" for c in t.comments[-5:]]
        return "\n".join([
            self._line(t, users, blocked_by),
            f"labels: {', '.join(l.name for l in t.labels) or 'none'}",
            f"blocks: {', '.join(self.db.get(Task, b).key for b in blocks.get(t.id, [])) or 'nothing'}",
            f"start: {t.start_date or '-'}  completed: {t.completed_at or '-'}",
            "description:", t.description or "(empty)",
            "recent comments:", *(comments or ["(none)"]),
        ])

    def create_task(self, **inp) -> str:
        out = tk.create_task(self.project.id, TaskIn(**self._fields(inp)), self.user, self.db)
        return f"Created {out.key}: {out.title}"

    def update_task(self, key: str, **inp) -> str:
        t = self._task(key)
        out = tk.update_task(self.project.id, t.id, TaskPatch(**self._fields(inp)), self.user, self.db)
        return f"Updated {out.key} ({', '.join(inp) or 'no fields'})"

    def add_dependency(self, blocker_key: str, blocked_key: str) -> str:
        a, b = self._task(blocker_key), self._task(blocked_key)
        tk.add_dependency(self.project.id, DependencyIn(blocker_id=a.id, blocked_id=b.id), self.user, self.db)
        return f"{a.key} now blocks {b.key}"

    def add_comment(self, key: str, body: str) -> str:
        t = self._task(key)
        tk.add_comment(self.project.id, t.id, CommentIn(body=body), self.user, self.db)
        return f"Commented on {t.key}"

    def get_analytics(self, kind: str) -> str:
        pid, u, db = self.project.id, self.user, self.db
        fn = {
            "summary": lambda: an.summary(pid, None, u, db),
            "risks": lambda: an.risks(pid, None, u, db),
            "forecast": lambda: {k: v for k, v in an.forecast(pid, None, "sprint", None, u, db).items() if k != "history"},
            "critical_path": lambda: {k: v for k, v in an.critical(pid, None, u, db).items() if k != "nodes"},
            "workload": lambda: an.workload(pid, None, None, u, db),
            "burndown": lambda: an.burndown(pid, None, None, u, db),
        }[kind]
        return json.dumps(fn(), default=str)

    # ---- dispatch ----------------------------------------------------------------
    def run(self, name: str, inp: dict) -> tuple[str, bool]:
        """Returns (content, is_error). Errors go back to the model so it can correct itself."""
        try:
            if name not in {t["name"] for t in TOOLS}:
                raise ToolError(f"Unknown tool {name}")
            return getattr(self, name)(**(inp or {})), False
        except HTTPException as e:
            self.db.rollback()
            return f"Error {e.status_code}: {e.detail}", True
        except (ToolError, ValidationError, ValueError, TypeError) as e:
            self.db.rollback()
            return f"Error: {e}", True
