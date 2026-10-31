"""Relational data model.

Hierarchy: Workspace -> Project -> Task, with Sprints, Labels and States scoped
to a project. Design notes:

* States carry a *group* (backlog/unstarted/started/completed/cancelled) so that
  custom column names still have well-defined semantics for analytics.
* Tasks get a per-project human key (KAI-42) via Project.task_counter.
* Board ordering uses a float `rank` so a drag-and-drop move updates one row.
* Every field change is written to TaskActivity (field, old, new) which powers
  the audit trail, burndown and throughput history.
"""
from __future__ import annotations

import enum
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Column,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Role(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class StateGroup(str, enum.Enum):
    backlog = "backlog"
    unstarted = "unstarted"
    started = "started"
    completed = "completed"
    cancelled = "cancelled"


class Priority(str, enum.Enum):
    none = "none"
    low = "low"
    medium = "medium"
    high = "high"
    urgent = "urgent"


class SprintStatus(str, enum.Enum):
    planned = "planned"
    active = "active"
    closed = "closed"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    avatar_color: Mapped[str] = mapped_column(String(9), default="#6366f1")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    members: Mapped[list["Membership"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")
    projects: Mapped[list["Project"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.member)
    weekly_capacity: Mapped[float] = mapped_column(Float, default=5.0)  # story points / week
    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("workspace_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(8))
    description: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(9), default="#6366f1")
    task_counter: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    workspace: Mapped[Workspace] = relationship(back_populates="projects")
    states: Mapped[list["State"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="State.position"
    )
    labels: Mapped[list["Label"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    tasks: Mapped[list["Task"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    sprints: Mapped[list["Sprint"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class State(Base):
    __tablename__ = "states"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    group: Mapped[StateGroup] = mapped_column(Enum(StateGroup))
    color: Mapped[str] = mapped_column(String(9), default="#94a3b8")
    position: Mapped[float] = mapped_column(Float, default=0)
    wip_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project: Mapped[Project] = relationship(back_populates="states")


class Label(Base):
    __tablename__ = "labels"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(9), default="#22c55e")
    project: Mapped[Project] = relationship(back_populates="labels")


task_labels = Table(
    "task_labels",
    Base.metadata,
    Column("task_id", ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("label_id", ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True),
)


class Sprint(Base):
    __tablename__ = "sprints"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    goal: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[SprintStatus] = mapped_column(Enum(SprintStatus), default=SprintStatus.planned)
    project: Mapped[Project] = relationship(back_populates="sprints")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("project_id", "number"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    state_id: Mapped[int] = mapped_column(ForeignKey("states.id"), index=True)
    priority: Mapped[Priority] = mapped_column(Enum(Priority), default=Priority.none)
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sprint_id: Mapped[int | None] = mapped_column(ForeignKey("sprints.id", ondelete="SET NULL"), nullable=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    estimate: Mapped[float | None] = mapped_column(Float, nullable=True)  # story points ~ ideal days
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rank: Mapped[float] = mapped_column(Float, default=65536.0, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="tasks")
    state: Mapped[State] = relationship()
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    labels: Mapped[list[Label]] = relationship(secondary=task_labels)
    sprint: Mapped[Sprint | None] = relationship()
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="Comment.created_at"
    )

    @property
    def key(self) -> str:
        return f"{self.project.key}-{self.number}"


class Dependency(Base):
    """`blocker` must finish before `blocked` can start (finish-to-start)."""

    __tablename__ = "dependencies"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    blocker_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    blocked_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    task: Mapped[Task] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()


class TaskActivity(Base):
    __tablename__ = "task_activity"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verb: Mapped[str] = mapped_column(String(30))  # created | updated | commented
    field: Mapped[str | None] = mapped_column(String(40), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    actor: Mapped[User | None] = relationship()
