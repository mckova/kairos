from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from ..auth import current_user, load_project
from ..db import get_db
from ..models import (
    Comment,
    Dependency,
    Label,
    Membership,
    Priority,
    Project,
    Role,
    Sprint,
    State,
    StateGroup,
    Task,
    TaskActivity,
    User,
    utcnow,
)
from ..realtime import hub
from ..schemas import (
    ActivityOut,
    CommentIn,
    CommentOut,
    DependencyIn,
    DependencyOut,
    MoveIn,
    TaskIn,
    TaskOut,
    TaskPatch,
)
from ..services import activity, ordering
from ..services.scheduling import would_create_cycle

router = APIRouter(prefix="/api/projects/{project_id}", tags=["tasks"])


# ---- helpers ----------------------------------------------------------------
def _deps(db: Session, project_id: int):
    blocked_by, blocks = defaultdict(list), defaultdict(list)
    for d in db.query(Dependency).filter_by(project_id=project_id):
        blocked_by[d.blocked_id].append(d.blocker_id)
        blocks[d.blocker_id].append(d.blocked_id)
    return blocked_by, blocks


def serialize(task: Task, blocked_by=None, blocks=None) -> TaskOut:
    out = TaskOut.model_validate(task)
    out.blocked_by = sorted((blocked_by or {}).get(task.id, []))
    out.blocks = sorted((blocks or {}).get(task.id, []))
    return out


def serialize_one(db: Session, task: Task) -> TaskOut:
    bb, bl = _deps(db, task.project_id)
    return serialize(task, bb, bl)


def _get_task(db: Session, project: Project, task_id: int) -> Task:
    t = db.get(Task, task_id)
    if t is None or t.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return t


def _check_refs(db: Session, project: Project, data: dict) -> None:
    if data.get("state_id") is not None:
        s = db.get(State, data["state_id"])
        if s is None or s.project_id != project.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "state_id is not in this project")
    if data.get("sprint_id") is not None:
        sp = db.get(Sprint, data["sprint_id"])
        if sp is None or sp.project_id != project.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "sprint_id is not in this project")
    if data.get("parent_id") is not None:
        parent = db.get(Task, data["parent_id"])
        if parent is None or parent.project_id != project.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "parent_id is not in this project")
    if data.get("assignee_id") is not None:
        if not db.query(Membership).filter_by(workspace_id=project.workspace_id, user_id=data["assignee_id"]).first():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "assignee is not a workspace member")
    if data.get("start_date") and data.get("due_date") and data["due_date"] < data["start_date"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "due_date is before start_date")


def _labels(db: Session, project: Project, ids: list[int]) -> list[Label]:
    labels = db.query(Label).filter(Label.project_id == project.id, Label.id.in_(ids)).all() if ids else []
    if len(labels) != len(set(ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown label id")
    return labels


def _apply_state(task: Task, state: State) -> None:
    task.state = state
    task.state_id = state.id
    if state.group == StateGroup.completed:
        task.completed_at = task.completed_at or utcnow()
    else:
        task.completed_at = None


# ---- tasks ------------------------------------------------------------------
@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    project_id: int,
    state_id: int | None = None,
    assignee_id: int | None = None,
    sprint_id: int | None = None,
    priority: Priority | None = None,
    label_id: int | None = None,
    q: str | None = Query(default=None, max_length=100),
    include_archived: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project = load_project(db, user, project_id)
    query = db.query(Task).options(selectinload(Task.labels)).filter(Task.project_id == project.id)
    if not include_archived:
        query = query.filter(Task.archived.is_(False))
    if state_id is not None:
        query = query.filter(Task.state_id == state_id)
    if assignee_id is not None:
        query = query.filter(Task.assignee_id == (None if assignee_id == 0 else assignee_id))
    if sprint_id is not None:
        query = query.filter(Task.sprint_id == (None if sprint_id == 0 else sprint_id))
    if priority is not None:
        query = query.filter(Task.priority == priority)
    if label_id is not None:
        query = query.filter(Task.labels.any(Label.id == label_id))
    if q:
        like = f"%{q}%"
        conds = [Task.title.ilike(like), Task.description.ilike(like)]
        tail = q.upper().removeprefix(f"{project.key}-")
        if tail.isdigit():
            conds.append(Task.number == int(tail))
        query = query.filter(or_(*conds))
    bb, bl = _deps(db, project.id)
    return [serialize(t, bb, bl) for t in query.order_by(Task.rank, Task.id).all()]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(project_id: int, body: TaskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id, Role.member)
    data = body.model_dump()
    _check_refs(db, project, data)
    label_ids = data.pop("label_ids")
    if data["state_id"] is None:
        default = next((s for s in project.states if s.group == StateGroup.unstarted), project.states[0])
        data["state_id"] = default.id
    project.task_counter += 1
    task = Task(project_id=project.id, number=project.task_counter, reporter_id=user.id, **data)
    task.labels = _labels(db, project, label_ids)
    task.rank = ordering.next_rank_at_bottom(db, project.id, data["state_id"])
    _apply_state(task, db.get(State, data["state_id"]))
    db.add(task)
    db.flush()
    activity.record(db, task, user, "created")
    db.commit()
    out = serialize_one(db, task)
    hub.publish(project.id, "task.created", out.model_dump(mode="json"), user.id)
    return out


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_task(project_id: int, task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    return serialize_one(db, _get_task(db, project, task_id))


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    project_id: int, task_id: int, body: TaskPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    project = load_project(db, user, project_id, Role.member)
    task = _get_task(db, project, task_id)
    changes = body.model_dump(exclude_unset=True)
    merged = {
        "start_date": changes.get("start_date", task.start_date),
        "due_date": changes.get("due_date", task.due_date),
        **{k: v for k, v in changes.items() if k not in ("start_date", "due_date")},
    }
    _check_refs(db, project, merged)
    if changes.get("parent_id") == task.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a task cannot be its own parent")

    if "label_ids" in changes:
        new = _labels(db, project, changes.pop("label_ids") or [])
        old_ids, new_ids = {l.id for l in task.labels}, {l.id for l in new}
        if old_ids != new_ids:
            activity.record(db, task, user, "updated", "labels", old_ids, new_ids)
            task.labels = new
    if "state_id" in changes:
        sid = changes.pop("state_id")
        if sid is not None and sid != task.state_id:
            activity.record(db, task, user, "updated", "state", task.state.name, db.get(State, sid).name)
            task.rank = ordering.next_rank_at_bottom(db, project.id, sid)
            _apply_state(task, db.get(State, sid))
    for field, value in changes.items():
        old = getattr(task, field)
        if old != value:
            activity.record(db, task, user, "updated", field, old, value)
            setattr(task, field, value)
    db.commit()
    out = serialize_one(db, task)
    hub.publish(project.id, "task.updated", out.model_dump(mode="json"), user.id)
    return out


@router.post("/tasks/{task_id}/move", response_model=TaskOut)
def move_task(
    project_id: int, task_id: int, body: MoveIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """Kanban drag-and-drop: re-rank one card, optionally across columns."""
    project = load_project(db, user, project_id, Role.member)
    task = _get_task(db, project, task_id)
    state = db.get(State, body.state_id)
    if state is None or state.project_id != project.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "state_id is not in this project")

    def neighbour(nid):
        if nid is None:
            return None
        n = _get_task(db, project, nid)
        if n.state_id != state.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "neighbour is in a different column")
        return n

    above, below = neighbour(body.before_id), neighbour(body.after_id)
    if ordering.needs_rebalance(above and above.rank, below and below.rank):
        ordering.renumber_column(db, project.id, state.id)
        db.flush()
    task.rank = ordering.rank_between(above.rank if above else None, below.rank if below else None)
    if state.id != task.state_id:
        activity.record(db, task, user, "updated", "state", task.state.name, state.name)
        _apply_state(task, state)
    db.commit()
    out = serialize_one(db, task)
    hub.publish(project.id, "task.moved", out.model_dump(mode="json"), user.id)
    return out


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(project_id: int, task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id, Role.member)
    task = _get_task(db, project, task_id)
    db.query(Task).filter_by(parent_id=task.id).update({"parent_id": None})
    db.delete(task)
    db.commit()
    hub.publish(project.id, "task.deleted", {"id": task_id}, user.id)


# ---- dependencies -----------------------------------------------------------
@router.post("/dependencies", response_model=DependencyOut, status_code=201)
def add_dependency(
    project_id: int, body: DependencyIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    project = load_project(db, user, project_id, Role.member)
    blocker, blocked = _get_task(db, project, body.blocker_id), _get_task(db, project, body.blocked_id)
    edges = [(d.blocker_id, d.blocked_id) for d in db.query(Dependency).filter_by(project_id=project.id)]
    if (blocker.id, blocked.id) in edges:
        raise HTTPException(status.HTTP_409_CONFLICT, "Dependency already exists")
    if would_create_cycle(edges, blocker.id, blocked.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "That would create a circular dependency")
    dep = Dependency(project_id=project.id, blocker_id=blocker.id, blocked_id=blocked.id)
    db.add(dep)
    activity.record(db, blocked, user, "updated", "blocked_by", None, blocker.key)
    db.commit()
    hub.publish(project.id, "dependency.created", {"blocker_id": blocker.id, "blocked_id": blocked.id}, user.id)
    return dep


@router.get("/dependencies", response_model=list[DependencyOut])
def list_dependencies(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    return db.query(Dependency).filter_by(project_id=project.id).all()


@router.delete("/dependencies/{dep_id}", status_code=204)
def remove_dependency(project_id: int, dep_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id, Role.member)
    dep = db.get(Dependency, dep_id)
    if dep is None or dep.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dependency not found")
    db.delete(dep)
    db.commit()
    hub.publish(project.id, "dependency.deleted", {"id": dep_id}, user.id)


# ---- comments & activity ----------------------------------------------------
@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut])
def list_comments(project_id: int, task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    return _get_task(db, project, task_id).comments


@router.post("/tasks/{task_id}/comments", response_model=CommentOut, status_code=201)
def add_comment(
    project_id: int, task_id: int, body: CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    project = load_project(db, user, project_id, Role.member)
    task = _get_task(db, project, task_id)
    c = Comment(task_id=task.id, author_id=user.id, body=body.body)
    db.add(c)
    activity.record(db, task, user, "commented")
    db.commit()
    db.refresh(c)
    hub.publish(project.id, "comment.created", {"task_id": task.id, "id": c.id}, user.id)
    return c


@router.get("/tasks/{task_id}/activity", response_model=list[ActivityOut])
def task_activity(project_id: int, task_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    project = load_project(db, user, project_id)
    task = _get_task(db, project, task_id)
    return db.query(TaskActivity).filter_by(task_id=task.id).order_by(TaskActivity.created_at, TaskActivity.id).all()


@router.get("/activity", response_model=list[ActivityOut])
def project_feed(
    project_id: int,
    limit: int = Query(default=50, le=200),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    project = load_project(db, user, project_id)
    return (
        db.query(TaskActivity)
        .filter_by(project_id=project.id)
        .order_by(TaskActivity.created_at.desc(), TaskActivity.id.desc())
        .limit(limit)
        .all()
    )
