from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import current_user, load_project
from ..db import get_db
from ..models import Role, Sprint, SprintStatus, StateGroup, Task, User
from ..realtime import hub
from ..schemas import SprintIn, SprintOut, SprintPatch

router = APIRouter(prefix="/api/projects/{project_id}/sprints", tags=["sprints"])


@router.get("", response_model=list[SprintOut])
def list_sprints(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id)
    return db.query(Sprint).filter_by(project_id=p.id).order_by(Sprint.start_date).all()


@router.post("", response_model=SprintOut, status_code=201)
def create_sprint(project_id: int, body: SprintIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.member)
    if body.status == SprintStatus.active and db.query(Sprint).filter_by(project_id=p.id, status=SprintStatus.active).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Another sprint is already active")
    s = Sprint(project_id=p.id, **body.model_dump())
    db.add(s)
    db.commit()
    hub.publish(p.id, "sprint.created", {"id": s.id}, user.id)
    return s


@router.patch("/{sprint_id}", response_model=SprintOut)
def update_sprint(
    project_id: int, sprint_id: int, body: SprintPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    p = load_project(db, user, project_id, Role.member)
    s = db.get(Sprint, sprint_id)
    if s is None or s.project_id != p.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint not found")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("status") == SprintStatus.active:
        other = db.query(Sprint).filter(
            Sprint.project_id == p.id, Sprint.status == SprintStatus.active, Sprint.id != s.id
        ).first()
        if other:
            raise HTTPException(status.HTTP_409_CONFLICT, f"Close '{other.name}' first")
    for k, v in changes.items():
        setattr(s, k, v)
    if s.end_date < s.start_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "end_date must be on or after start_date")
    # Closing a sprint rolls unfinished work back to the backlog (sprint_id = NULL).
    if changes.get("status") == SprintStatus.closed:
        for t in db.query(Task).filter_by(sprint_id=s.id).all():
            if t.state.group not in (StateGroup.completed, StateGroup.cancelled):
                t.sprint_id = None
    db.commit()
    hub.publish(p.id, "sprint.updated", {"id": s.id}, user.id)
    return s
