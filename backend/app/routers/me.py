"""Cross-project, per-user endpoints: inbox, "my work" and global search."""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, selectinload

from ..auth import current_user
from ..db import get_db
from ..models import Dependency, Membership, Notification, Project, StateGroup, Task, User, utcnow
from ..schemas import UserOut

router = APIRouter(prefix="/api", tags=["me"])
CLOSED = {StateGroup.completed, StateGroup.cancelled}


class NotificationOut(BaseModel):
    id: int
    kind: str
    text: str
    project_id: int
    task_id: int
    task_key: str
    read: bool
    created_at: datetime
    actor: UserOut | None


class ReadIn(BaseModel):
    ids: list[int] | None = None  # None = mark everything read


class MyTaskOut(BaseModel):
    id: int
    key: str
    title: str
    project_id: int
    project_name: str
    project_color: str
    state: str
    state_group: str
    priority: str
    estimate: float | None
    due_date: date | None
    sprint: str | None
    blocked: bool
    overdue: bool


class SearchHit(BaseModel):
    id: int
    key: str
    title: str
    project_id: int
    project_name: str
    project_color: str
    state: str
    state_group: str
    assignee_id: int | None


def project_ids(db: Session, user: User) -> list[int]:
    ws = [m.workspace_id for m in db.query(Membership).filter_by(user_id=user.id)]
    return [p.id for p in db.query(Project.id).filter(Project.workspace_id.in_(ws))] if ws else []


def _note(n: Notification) -> NotificationOut:
    return NotificationOut(id=n.id, kind=n.kind.value, text=n.text, project_id=n.project_id, task_id=n.task_id,
                           task_key=n.task.key, read=n.read_at is not None, created_at=n.created_at,
                           actor=UserOut.model_validate(n.actor) if n.actor else None)


@router.get("/me/notifications")
def notifications(limit: int = Query(default=40, le=200), user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter_by(user_id=user.id)
    unread = q.filter(Notification.read_at.is_(None)).count()
    items = q.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()
    return {"unread": unread, "items": [_note(n) for n in items]}


@router.post("/me/notifications/read")
def mark_read(body: ReadIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None))
    if body.ids is not None:
        q = q.filter(Notification.id.in_(body.ids))
    n = q.update({Notification.read_at: utcnow()}, synchronize_session=False)
    db.commit()
    return {"marked": n}


def my_open_tasks(db: Session, user: User) -> list[MyTaskOut]:
    pids = project_ids(db, user)
    if not pids:
        return []
    tasks = (db.query(Task).options(selectinload(Task.state), selectinload(Task.project), selectinload(Task.sprint))
             .filter(Task.project_id.in_(pids), Task.assignee_id == user.id, Task.archived.is_(False)).all())
    tasks = [t for t in tasks if t.state.group not in CLOSED]
    ids = [t.id for t in tasks]
    blockers = db.query(Dependency).filter(Dependency.blocked_id.in_(ids)).all() if ids else []
    open_blocker = {d.blocked_id for d in blockers if db.get(Task, d.blocker_id).state.group not in CLOSED}
    today = date.today()
    order = {"urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
    tasks.sort(key=lambda t: (t.due_date or date.max, order[t.priority.value], t.id))
    return [MyTaskOut(id=t.id, key=t.key, title=t.title, project_id=t.project_id, project_name=t.project.name,
                      project_color=t.project.color, state=t.state.name, state_group=t.state.group.value,
                      priority=t.priority.value, estimate=t.estimate, due_date=t.due_date,
                      sprint=t.sprint.name if t.sprint else None, blocked=t.id in open_blocker,
                      overdue=bool(t.due_date and t.due_date < today)) for t in tasks]


@router.get("/me/tasks", response_model=list[MyTaskOut])
def my_tasks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return my_open_tasks(db, user)


@router.get("/search", response_model=list[SearchHit])
def search(q: str = Query(min_length=1, max_length=100), limit: int = Query(default=12, le=50),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Tasks across every project the user can see, by key (APO-12), number or title words."""
    pids = project_ids(db, user)
    if not pids:
        return []
    query = (db.query(Task).join(Project).options(selectinload(Task.state), selectinload(Task.project))
             .filter(Task.project_id.in_(pids), Task.archived.is_(False)))
    text = q.strip()
    cond = and_(*[func.lower(Task.title).contains(w.lower()) for w in text.split()])
    if "-" in text:
        k, _, tail = text.rpartition("-")
        if tail.isdigit():
            cond = or_(cond, (func.upper(Project.key) == k.upper()) & (Task.number == int(tail)))
    elif text.isdigit():
        cond = or_(cond, Task.number == int(text))
    hits = query.filter(cond).order_by(Task.updated_at.desc()).limit(limit).all()
    return [SearchHit(id=t.id, key=t.key, title=t.title, project_id=t.project_id, project_name=t.project.name,
                      project_color=t.project.color, state=t.state.name, state_group=t.state.group.value,
                      assignee_id=t.assignee_id) for t in hits]
