from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import current_user, require_membership
from ..db import get_db
from ..models import Membership, Project, Role, State, StateGroup, User, Workspace
from ..schemas import InviteIn, MemberOut, ProjectIn, ProjectOut, WorkspaceIn, WorkspaceOut

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

DEFAULT_STATES = [
    ("Backlog", StateGroup.backlog, "#94a3b8", None),
    ("To do", StateGroup.unstarted, "#64748b", None),
    ("In progress", StateGroup.started, "#f59e0b", 4),
    ("In review", StateGroup.started, "#8b5cf6", 3),
    ("Done", StateGroup.completed, "#22c55e", None),
    ("Cancelled", StateGroup.cancelled, "#ef4444", None),
]


@router.get("", response_model=list[WorkspaceOut])
def my_workspaces(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.query(Workspace).join(Membership).filter(Membership.user_id == user.id).order_by(Workspace.id).all()


@router.post("", response_model=WorkspaceOut, status_code=201)
def create_workspace(body: WorkspaceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.query(Workspace).filter_by(slug=body.slug).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Slug taken")
    ws = Workspace(name=body.name, slug=body.slug)
    ws.members.append(Membership(user=user, role=Role.owner))
    db.add(ws)
    db.commit()
    return ws


@router.get("/{workspace_id}/members", response_model=list[MemberOut])
def members(workspace_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_membership(db, user, workspace_id)
    return db.query(Membership).filter_by(workspace_id=workspace_id).all()


@router.post("/{workspace_id}/members", response_model=MemberOut, status_code=201)
def invite(workspace_id: int, body: InviteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_membership(db, user, workspace_id, Role.admin)
    target = db.query(User).filter_by(email=body.email.lower()).first()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with that email - ask them to sign up first")
    if db.query(Membership).filter_by(workspace_id=workspace_id, user_id=target.id).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Already a member")
    if body.role == Role.owner:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ownership cannot be granted by invite")
    m = Membership(workspace_id=workspace_id, user=target, role=body.role)
    db.add(m)
    db.commit()
    return m


@router.get("/{workspace_id}/projects", response_model=list[ProjectOut])
def list_projects(workspace_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_membership(db, user, workspace_id)
    return db.query(Project).filter_by(workspace_id=workspace_id).order_by(Project.id).all()


@router.post("/{workspace_id}/projects", response_model=ProjectOut, status_code=201)
def create_project(
    workspace_id: int, body: ProjectIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    require_membership(db, user, workspace_id, Role.admin)
    if db.query(Project).filter_by(workspace_id=workspace_id, key=body.key).first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Project key {body.key} already used")
    p = Project(workspace_id=workspace_id, **body.model_dump())
    for i, (name, group, color, wip) in enumerate(DEFAULT_STATES):
        p.states.append(State(name=name, group=group, color=color, position=(i + 1) * 1000, wip_limit=wip))
    db.add(p)
    db.commit()
    return p
