from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..ai import client as ai
from ..ai import copilot
from ..auth import current_user, load_project
from ..db import get_db
from ..models import Membership, Priority, Role, Sprint, SprintStatus, Task, User
from ..schemas import DependencyIn, TaskIn, TaskOut
from . import tasks as tk

router = APIRouter(tags=["ai"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)


class BreakdownIn(BaseModel):
    task_id: int


class SubtaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    estimate: float | None = Field(default=None, ge=0, le=100)
    priority: Priority = Priority.none
    depends_on: list[int] = []


class ApplyBreakdownIn(BaseModel):
    task_id: int
    subtasks: list[SubtaskIn] = Field(min_length=1, max_length=20)


class ParseIn(BaseModel):
    text: str = Field(min_length=2, max_length=2000)


class ReportIn(BaseModel):
    sprint_id: int | None = None


def _guard(fn, *args):
    """Run an AI call and translate failures into clean HTTP errors."""
    try:
        return fn(*args)
    except ai.AIUnavailable as e:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e))
    except HTTPException:
        raise
    except Exception as e:  # anthropic.APIError and friends
        import anthropic

        if isinstance(e, anthropic.RateLimitError):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "AI is rate limited - try again shortly")
        if isinstance(e, anthropic.APIError):
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"AI provider error: {getattr(e, 'message', e)}")
        raise


@router.get("/api/ai/status")
def ai_status(_: User = Depends(current_user)):
    return {"enabled": ai.enabled(), "model": ai.MODEL}


@router.post("/api/projects/{project_id}/ai/chat")
def chat(project_id: int, body: ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    if body.messages[-1].role != "user":
        raise HTTPException(422, "last message must come from the user")
    return _guard(copilot.run_copilot, db, user, project, [m.model_dump() for m in body.messages])


@router.post("/api/projects/{project_id}/ai/breakdown")
def propose_breakdown(project_id: int, body: BreakdownIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id, Role.member)
    task = tk._get_task(db, project, body.task_id)
    return _guard(copilot.breakdown, db, user, project, task)


@router.post("/api/projects/{project_id}/ai/breakdown/apply", response_model=list[TaskOut], status_code=201)
def apply_breakdown(project_id: int, body: ApplyBreakdownIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Create the (possibly user-edited) subtasks under the parent, wiring their dependencies."""
    project = load_project(db, user, project_id, Role.member)
    parent = tk._get_task(db, project, body.task_id)
    created: list[TaskOut] = []
    for s in body.subtasks:
        created.append(tk.create_task(project.id, TaskIn(
            title=s.title, description=s.description, estimate=s.estimate, priority=s.priority,
            parent_id=parent.id, sprint_id=parent.sprint_id, assignee_id=parent.assignee_id,
        ), user, db))
    for i, s in enumerate(body.subtasks):
        for d in s.depends_on:
            if 0 <= d < i:
                tk.add_dependency(project.id, DependencyIn(blocker_id=created[d].id, blocked_id=created[i].id), user, db)
    return [tk.serialize_one(db, db.get(Task, t.id)) for t in created]


@router.post("/api/projects/{project_id}/ai/parse-task")
def parse_task(project_id: int, body: ParseIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id, Role.member)
    members = [{"id": m.user_id, "name": m.user.name} for m in db.query(Membership).filter_by(workspace_id=project.workspace_id)]
    sprints = [{"id": s.id, "name": s.name, "status": s.status.value}
               for s in db.query(Sprint).filter(Sprint.project_id == project.id, Sprint.status != SprintStatus.closed)]
    return _guard(copilot.parse_task, project, members, sprints, body.text)


@router.post("/api/projects/{project_id}/ai/report")
def report(project_id: int, body: ReportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    sprint = None
    if body.sprint_id is not None:
        sprint = db.get(Sprint, body.sprint_id)
        if sprint is None or sprint.project_id != project.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint not found")
    else:
        sprint = db.query(Sprint).filter_by(project_id=project.id, status=SprintStatus.active).first()
    return {"markdown": _guard(copilot.status_report, db, user, project, sprint)}


class TriageIn(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: str = Field(default="", max_length=10_000)


@router.post("/api/projects/{project_id}/ai/triage")
def triage(project_id: int, body: TriageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Suggest priority, estimate, labels and an owner for a draft task, and flag likely duplicates."""
    from collections import defaultdict

    project = load_project(db, user, project_id, Role.member)
    tasks = db.query(Task).filter_by(project_id=project.id, archived=False).order_by(Task.id.desc()).limit(150).all()
    open_pts: dict[int | None, float] = defaultdict(float)
    done_titles: dict[int | None, list[str]] = defaultdict(list)
    for t in tasks:
        if t.state.group.value in ("completed", "cancelled"):
            done_titles[t.assignee_id].append(t.title)
        else:
            open_pts[t.assignee_id] += t.estimate or 1
    people = [{"id": m.user_id, "name": m.user.name, "weekly_capacity": m.weekly_capacity,
               "open_points": open_pts.get(m.user_id, 0), "recently_done": done_titles.get(m.user_id, [])[:8]}
              for m in db.query(Membership).filter_by(workspace_id=project.workspace_id) if m.role != Role.viewer]
    existing = [{"id": t.id, "key": t.key, "title": t.title, "state": t.state.name, "estimate": t.estimate,
                 "priority": t.priority.value, "assignee_id": t.assignee_id} for t in tasks]
    data = _guard(copilot.triage, project, body.title, body.description, existing, people)
    by_id = {t.id: t for t in tasks}
    for d in data["duplicates"]:
        d["key"], d["title"] = by_id[d["task_id"]].key, by_id[d["task_id"]].title
    return data


@router.post("/api/me/ai/plan")
def plan_my_day(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """AI daily plan across every project: what to focus on today, what to chase, what changed."""
    from ..models import Notification
    from .me import my_open_tasks

    tasks = my_open_tasks(db, user)
    unread = (db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None))
              .order_by(Notification.created_at.desc()).limit(25).all())
    facts = [t.model_dump(mode="json") for t in tasks]
    data = _guard(copilot.plan_day, user, facts, [n.text for n in unread])
    by_id = {t.id: t for t in tasks}
    for f in data["focus"]:
        t = by_id[f["task_id"]]
        f.update(key=t.key, title=t.title, project_id=t.project_id, project_name=t.project_name)
    return data
