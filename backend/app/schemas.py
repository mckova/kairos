"""Pydantic request/response contracts."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import Priority, Role, SprintStatus, StateGroup


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth -----------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORM):
    id: int
    email: str
    name: str
    avatar_color: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ---- workspace --------------------------------------------------------------
class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,58}$")


class WorkspaceOut(ORM):
    id: int
    name: str
    slug: str


class MemberOut(ORM):
    user: UserOut
    role: Role
    weekly_capacity: float


class InviteIn(BaseModel):
    email: EmailStr
    role: Role = Role.member


# ---- project ----------------------------------------------------------------
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    key: str = Field(pattern=r"^[A-Z][A-Z0-9]{1,7}$")
    description: str = ""
    color: str = "#6366f1"


class StateOut(ORM):
    id: int
    name: str
    group: StateGroup
    color: str
    position: float
    wip_limit: int | None


class StateIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    group: StateGroup
    color: str = "#94a3b8"
    wip_limit: int | None = None


class LabelIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = "#22c55e"


class LabelOut(ORM):
    id: int
    name: str
    color: str


class ProjectOut(ORM):
    id: int
    workspace_id: int
    name: str
    key: str
    description: str
    color: str
    states: list[StateOut]
    labels: list[LabelOut]


# ---- sprint -----------------------------------------------------------------
class SprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    goal: str = ""
    start_date: date
    end_date: date
    status: SprintStatus = SprintStatus.planned

    @field_validator("end_date")
    @classmethod
    def _order(cls, v, info):
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


class SprintPatch(BaseModel):
    name: str | None = None
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: SprintStatus | None = None


class SprintOut(ORM):
    id: int
    name: str
    goal: str
    start_date: date
    end_date: date
    status: SprintStatus


# ---- task -------------------------------------------------------------------
class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    state_id: int | None = None
    priority: Priority = Priority.none
    assignee_id: int | None = None
    sprint_id: int | None = None
    parent_id: int | None = None
    estimate: float | None = Field(default=None, ge=0, le=100)
    start_date: date | None = None
    due_date: date | None = None
    label_ids: list[int] = []


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    state_id: int | None = None
    priority: Priority | None = None
    assignee_id: int | None = None
    sprint_id: int | None = None
    parent_id: int | None = None
    estimate: float | None = Field(default=None, ge=0, le=100)
    start_date: date | None = None
    due_date: date | None = None
    label_ids: list[int] | None = None
    archived: bool | None = None


class MoveIn(BaseModel):
    """Drag-and-drop: drop into `state_id` between two neighbours (either may be null)."""

    state_id: int
    before_id: int | None = None  # task that will be directly above
    after_id: int | None = None  # task that will be directly below


class TaskOut(ORM):
    id: int
    key: str
    number: int
    project_id: int
    title: str
    description: str
    state_id: int
    priority: Priority
    assignee_id: int | None
    reporter_id: int | None
    sprint_id: int | None
    parent_id: int | None
    estimate: float | None
    start_date: date | None
    due_date: date | None
    rank: float
    completed_at: datetime | None
    archived: bool
    created_at: datetime
    updated_at: datetime
    labels: list[LabelOut]
    blocked_by: list[int] = []
    blocks: list[int] = []


class DependencyIn(BaseModel):
    blocker_id: int
    blocked_id: int


class DependencyOut(ORM):
    id: int
    blocker_id: int
    blocked_id: int


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)


class CommentOut(ORM):
    id: int
    body: str
    created_at: datetime
    author: UserOut


class ActivityOut(ORM):
    id: int
    task_id: int
    verb: str
    field: str | None
    old_value: str | None
    new_value: str | None
    created_at: datetime
    actor: UserOut | None
