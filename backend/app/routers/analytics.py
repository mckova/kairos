"""Insight endpoints: summary, burndown, Monte Carlo forecast, critical path, workload, risk radar.

Every endpoint accepts `as_of` (defaults to today) so results are reproducible
in tests and demos.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, selectinload

from ..auth import current_user, load_project
from ..db import get_db
from ..models import Dependency, Membership, Sprint, SprintStatus, StateGroup, Task, User
from ..services.forecast import daily_throughput, simulate
from ..services.scheduling import WEEKEND, add_working_days, critical_path, working_days_between

router = APIRouter(prefix="/api/projects/{project_id}/analytics", tags=["analytics"])

DONE = (StateGroup.completed,)
CLOSED = (StateGroup.completed, StateGroup.cancelled)


def _pts(t: Task) -> float:
    return t.estimate if t.estimate is not None else 1.0


def _tasks(db: Session, project_id: int) -> list[Task]:
    return (
        db.query(Task)
        .options(selectinload(Task.state))
        .filter(Task.project_id == project_id, Task.archived.is_(False))
        .all()
    )


def _sprint(db: Session, project_id: int, sprint_id: int | None) -> Sprint:
    if sprint_id is None:
        s = db.query(Sprint).filter_by(project_id=project_id, status=SprintStatus.active).first()
        if s is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No active sprint - pass sprint_id")
        return s
    s = db.get(Sprint, sprint_id)
    if s is None or s.project_id != project_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sprint not found")
    return s


@router.get("/summary")
def summary(project_id: int, as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id)
    today = as_of or date.today()
    tasks = _tasks(db, p.id)
    by_group = Counter(t.state.group.value for t in tasks)
    by_state = Counter(t.state_id for t in tasks)
    by_priority = Counter(t.priority.value for t in tasks if t.state.group not in CLOSED)
    scope = sum(_pts(t) for t in tasks if t.state.group != StateGroup.cancelled)
    done = sum(_pts(t) for t in tasks if t.state.group in DONE)

    weeks = []
    for w in range(7, -1, -1):
        end = today - timedelta(days=7 * w)
        start = end - timedelta(days=6)
        pts = sum(_pts(t) for t in tasks if t.completed_at and start <= t.completed_at.date() <= end)
        weeks.append({"week_ending": end.isoformat(), "points": pts})

    lead = [
        (t.completed_at.date() - t.created_at.date()).days
        for t in tasks
        if t.completed_at and t.completed_at.date() >= today - timedelta(days=60)
    ]
    overdue = [t for t in tasks if t.due_date and t.due_date < today and t.state.group not in CLOSED]
    return {
        "tasks_total": len(tasks),
        "by_group": dict(by_group),
        "by_state": {str(k): v for k, v in by_state.items()},
        "open_by_priority": dict(by_priority),
        "scope_points": scope,
        "done_points": done,
        "completion": round(done / scope, 3) if scope else 0.0,
        "overdue": len(overdue),
        "weekly_throughput": weeks,
        "avg_lead_time_days": round(sum(lead) / len(lead), 1) if lead else None,
    }


@router.get("/burndown")
def burndown(
    project_id: int,
    sprint_id: int | None = None,
    as_of: date | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    p = load_project(db, user, project_id)
    s = _sprint(db, p.id, sprint_id)
    today = as_of or date.today()
    tasks = [t for t in _tasks(db, p.id) if t.sprint_id == s.id and t.state.group != StateGroup.cancelled]
    scope = sum(_pts(t) for t in tasks)
    days = []
    d = s.start_date
    while d <= s.end_date:
        if d.weekday() not in WEEKEND:
            days.append(d)
        d += timedelta(days=1)
    n = max(len(days) - 1, 1)
    series = []
    for i, d in enumerate(days):
        point = {"date": d.isoformat(), "ideal": round(scope - scope * i / n, 2)}
        if d <= today:
            burned = sum(_pts(t) for t in tasks if t.completed_at and t.completed_at.date() <= d)
            point["remaining"] = round(scope - burned, 2)
        series.append(point)
    return {"sprint": {"id": s.id, "name": s.name, "start": s.start_date, "end": s.end_date}, "scope": scope, "series": series}


@router.get("/forecast")
def forecast(
    project_id: int,
    sprint_id: int | None = None,
    scope: str = "sprint",
    as_of: date | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Monte Carlo: P(finish by sprint end) and P50/P85/P95 dates. scope=sprint|project."""
    p = load_project(db, user, project_id)
    today = as_of or date.today()
    tasks = _tasks(db, p.id)
    completions = [(t.completed_at.date(), _pts(t)) for t in tasks if t.completed_at]
    samples = daily_throughput(completions, today - timedelta(days=1))
    deadline, target = None, tasks
    if scope == "sprint":
        s = _sprint(db, p.id, sprint_id)
        deadline, target = s.end_date, [t for t in tasks if t.sprint_id == s.id]
    remaining = sum(_pts(t) for t in target if t.state.group not in CLOSED)
    result = simulate(remaining, samples, today, deadline)
    result["deadline"] = deadline.isoformat() if deadline else None
    result["history"] = samples
    return result


@router.get("/critical-path")
def critical(project_id: int, as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = load_project(db, user, project_id)
    today = as_of or date.today()
    tasks = {t.id: t for t in _tasks(db, p.id) if t.state.group != StateGroup.cancelled}
    durations = {i: (0.0 if t.state.group in DONE else max(_pts(t), 0.5)) for i, t in tasks.items()}
    edges = [(d.blocker_id, d.blocked_id) for d in db.query(Dependency).filter_by(project_id=p.id)]
    cpm = critical_path(durations, edges)
    nodes = []
    for i in cpm["order"]:
        n, t = cpm["nodes"][i], tasks[i]
        nodes.append(
            {
                "task_id": i,
                "key": t.key,
                "title": t.title,
                "duration": n.duration,
                "earliest_start": add_working_days(today, n.es).isoformat(),
                "earliest_finish": add_working_days(today, max(n.ef - 1, n.es) if n.duration else n.es).isoformat(),
                "slack_days": n.slack,
                "critical": i in cpm["critical"],
            }
        )
    end = add_working_days(today, max(cpm["length"] - 1, 0)) if cpm["length"] else today
    return {
        "length_days": cpm["length"],
        "projected_finish": end.isoformat(),
        "chain": [tasks[i].key for i in cpm["chain"]],
        "chain_ids": cpm["chain"],
        "nodes": nodes,
    }


@router.get("/workload")
def workload(
    project_id: int,
    sprint_id: int | None = None,
    as_of: date | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Open sprint points per person vs. capacity for the *remaining* part of the sprint."""
    p = load_project(db, user, project_id)
    s = _sprint(db, p.id, sprint_id)
    today = max(as_of or date.today(), s.start_date)
    left = working_days_between(today, s.end_date) + (0 if today.weekday() in WEEKEND else 1)
    weeks = max(left, 1) / 5
    load = defaultdict(float)
    for t in _tasks(db, p.id):
        if t.sprint_id == s.id and t.state.group not in CLOSED:
            load[t.assignee_id] += _pts(t)
    rows = []
    for m in db.query(Membership).filter_by(workspace_id=p.workspace_id).all():
        cap = round(m.weekly_capacity * weeks, 1)
        assigned = load.pop(m.user_id, 0.0)
        rows.append(
            {
                "user_id": m.user_id,
                "name": m.user.name,
                "avatar_color": m.user.avatar_color,
                "assigned_points": assigned,
                "capacity_points": cap,
                "utilization": round(assigned / cap, 2) if cap else None,
            }
        )
    return {"sprint_id": s.id, "working_days_left": left, "members": rows, "unassigned_points": load.get(None, 0.0)}


@router.get("/risks")
def risks(project_id: int, as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Rule-based risk radar: each finding carries a severity, the task(s) involved and a suggested action."""
    p = load_project(db, user, project_id)
    today = as_of or date.today()
    tasks = {t.id: t for t in _tasks(db, p.id)}
    open_ = {i: t for i, t in tasks.items() if t.state.group not in CLOSED}
    deps = db.query(Dependency).filter_by(project_id=p.id).all()
    findings = []

    def add(kind, severity, task, message, action):
        findings.append(
            {"kind": kind, "severity": severity, "task_id": task.id if task else None,
             "key": task.key if task else None, "message": message, "action": action}
        )

    for t in open_.values():
        if t.due_date and t.due_date < today:
            add("overdue", "high", t, f"{t.key} is {(today - t.due_date).days} days overdue", "Re-plan the date or split the task")
        elif t.due_date and t.state.group in (StateGroup.backlog, StateGroup.unstarted):
            left = working_days_between(today, t.due_date)
            if left < _pts(t):
                add("at_risk", "medium", t, f"{t.key} not started, {left} working days left for {_pts(t):g} pts",
                    "Start it now or move the due date")
    for d in deps:
        blocker, blocked = tasks.get(d.blocker_id), tasks.get(d.blocked_id)
        if blocker and blocked and blocked.id in open_ and blocker.id in open_ and blocked.state.group == StateGroup.started:
            add("blocked_in_progress", "high", blocked,
                f"{blocked.key} is in progress but still blocked by {blocker.key}", f"Finish {blocker.key} first")
    for st in p.states:
        if st.wip_limit:
            n = sum(1 for t in open_.values() if t.state_id == st.id)
            if n > st.wip_limit:
                add("wip_exceeded", "medium", None, f"'{st.name}' has {n} tasks (WIP limit {st.wip_limit})",
                    "Finish work before pulling more")
    active = db.query(Sprint).filter_by(project_id=p.id, status=SprintStatus.active).first()
    if active:
        for t in open_.values():
            if t.sprint_id == active.id and t.estimate is None:
                add("unestimated", "low", t, f"{t.key} is in the sprint without an estimate", "Estimate it so forecasts stay honest")
        try:
            wl = workload(project_id, active.id, today, user, db)
            spare = {m["user_id"]: m["capacity_points"] - m["assigned_points"] for m in wl["members"]}
            names = {m["user_id"]: m["name"] for m in wl["members"]}
            for m in wl["members"]:
                if not (m["utilization"] and m["utilization"] > 1.0):
                    continue
                # Suggest handing off the smallest not-yet-started task to whoever has the most spare capacity.
                movable = sorted(
                    (t for t in open_.values() if t.sprint_id == active.id and t.assignee_id == m["user_id"]
                     and t.state.group in (StateGroup.backlog, StateGroup.unstarted)),
                    key=lambda t: (_pts(t), t.number),
                )
                action = "Rebalance assignments"
                target = max((u for u in spare if u != m["user_id"]), key=lambda u: spare[u], default=None)
                if movable and target is not None and spare[target] >= _pts(movable[0]):
                    t = movable[0]
                    action = f"Hand {t.key} ({_pts(t):g} pts) to {names[target]}, who has {spare[target]:g} pts spare"
                    spare[target] -= _pts(t)
                findings.append({"kind": "overloaded", "severity": "medium", "task_id": movable[0].id if movable else None,
                                 "key": movable[0].key if movable else None,
                                 "message": f"{m['name']} is at {int(m['utilization'] * 100)}% of capacity",
                                 "action": action})
        except HTTPException:
            pass
    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: order[f["severity"]])
    return {"count": len(findings), "findings": findings}
