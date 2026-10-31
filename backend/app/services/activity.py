"""Field-level audit trail: one TaskActivity row per changed field."""
from datetime import date, datetime
from enum import Enum

from sqlalchemy.orm import Session

from ..models import TaskActivity, Task, User


def _fmt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, (list, tuple, set)):
        return ",".join(str(x) for x in sorted(v))
    return str(v)


def record(db: Session, task: Task, actor: User | None, verb: str, field=None, old=None, new=None) -> TaskActivity:
    entry = TaskActivity(
        project_id=task.project_id,
        task_id=task.id,
        actor_id=actor.id if actor else None,
        verb=verb,
        field=field,
        old_value=_fmt(old),
        new_value=_fmt(new),
    )
    db.add(entry)
    return entry
