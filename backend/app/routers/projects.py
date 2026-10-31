from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import current_user, load_project
from ..db import get_db
from ..models import Label, Role, State, Task, User
from ..realtime import hub
from ..schemas import LabelIn, LabelOut, ProjectIn, ProjectOut, StateIn, StateOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return load_project(db, user, project_id)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, body: ProjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.admin)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return p


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.owner)
    db.delete(p)
    db.commit()


@router.post("/{project_id}/states", response_model=StateOut, status_code=201)
def add_state(project_id: int, body: StateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.admin)
    last = max((s.position for s in p.states), default=0)
    s = State(project_id=p.id, position=last + 1000, **body.model_dump())
    db.add(s)
    db.commit()
    hub.publish(p.id, "project.updated", {"id": p.id}, user.id)
    return s


@router.patch("/{project_id}/states/{state_id}", response_model=StateOut)
def edit_state(
    project_id: int, state_id: int, body: StateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    load_project(db, user, project_id, Role.admin)
    s = db.get(State, state_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "State not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    hub.publish(project_id, "project.updated", {"id": project_id}, user.id)
    return s


@router.delete("/{project_id}/states/{state_id}", status_code=204)
def delete_state(project_id: int, state_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.admin)
    s = db.get(State, state_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "State not found")
    if db.query(Task).filter_by(state_id=state_id).count():
        raise HTTPException(status.HTTP_409_CONFLICT, "Move the tasks out of this column first")
    if len(p.states) <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "A project needs at least one state")
    db.delete(s)
    db.commit()


@router.post("/{project_id}/labels", response_model=LabelOut, status_code=201)
def add_label(project_id: int, body: LabelIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id, Role.member)
    label = Label(project_id=p.id, **body.model_dump())
    db.add(label)
    db.commit()
    hub.publish(p.id, "project.updated", {"id": p.id}, user.id)
    return label
