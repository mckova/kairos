"""Inbox notifications: assignment, @mentions, comments and status changes.

Recipients never include the actor. Mentions are written as @firstname, @full.name
or @email-local-part and are resolved against the workspace members only.
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from ..models import Membership, Notification, NotificationKind, Task, User
from ..realtime import hub

MENTION = re.compile(r"@([\w.\-]+)", re.UNICODE)


def _handles(u: User) -> set[str]:
    name = u.name.lower()
    return {name.split()[0], name.replace(" ", "."), name.replace(" ", ""), u.email.split("@")[0].lower()}


def mentioned_users(db: Session, workspace_id: int, text: str) -> list[User]:
    tokens = {m.lower().rstrip(".") for m in MENTION.findall(text)}
    if not tokens:
        return []
    members = [m.user for m in db.query(Membership).filter_by(workspace_id=workspace_id)]
    return [u for u in members if _handles(u) & tokens]


def notify(db: Session, task: Task, actor: User | None, kind: NotificationKind, text: str, recipients) -> list[Notification]:
    seen: set[int] = set()
    out = []
    for uid in recipients:
        if uid is None or uid in seen or (actor and uid == actor.id):
            continue
        seen.add(uid)
        n = Notification(user_id=uid, actor_id=actor.id if actor else None, project_id=task.project_id,
                         task_id=task.id, kind=kind, text=text[:300])
        db.add(n)
        out.append(n)
    return out


def push(db: Session, notes: list[Notification]) -> None:
    """Call after commit: tells each recipient's open tabs to refresh the inbox."""
    for n in notes:
        hub.publish_user(n.user_id, "notification.created", {"id": n.id, "kind": n.kind.value, "text": n.text})
