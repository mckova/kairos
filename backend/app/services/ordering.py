"""Fractional ranking for drag-and-drop.

A moved card gets the midpoint between its new neighbours, so a move is a
single-row UPDATE. When the gap between neighbours collapses below EPS the
column is renumbered (rare, O(n) once).
"""
from sqlalchemy.orm import Session

from ..models import Task

STEP = 65536.0
EPS = 1e-6


def rank_between(above: float | None, below: float | None) -> float:
    if above is None and below is None:
        return STEP
    if above is None:
        return below / 2.0 if below > 0 else below - STEP
    if below is None:
        return above + STEP
    return (above + below) / 2.0


def next_rank_at_bottom(db: Session, project_id: int, state_id: int) -> float:
    last = (
        db.query(Task.rank)
        .filter(Task.project_id == project_id, Task.state_id == state_id)
        .order_by(Task.rank.desc())
        .first()
    )
    return rank_between(last[0] if last else None, None)


def renumber_column(db: Session, project_id: int, state_id: int) -> None:
    tasks = (
        db.query(Task)
        .filter(Task.project_id == project_id, Task.state_id == state_id)
        .order_by(Task.rank)
        .all()
    )
    for i, t in enumerate(tasks, start=1):
        t.rank = i * STEP


def needs_rebalance(above: float | None, below: float | None) -> bool:
    return above is not None and below is not None and abs(below - above) < EPS
