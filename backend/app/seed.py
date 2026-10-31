"""Populate a realistic demo workspace.

    python -m app.seed            # creates tables + demo data (idempotent: wipes demo workspace first)

Login: demo@kairos.dev / demo1234
"""
import random
from datetime import date, datetime, timedelta

from .auth import hash_password
from .db import Base, SessionLocal, engine
from .models import (
    Notification,
    NotificationKind,
    Comment,
    Dependency,
    Label,
    Membership,
    Priority,
    Project,
    Role,
    Sprint,
    SprintStatus,
    State,
    StateGroup,
    Task,
    TaskActivity,
    utcnow,
    User,
    Workspace,
)
from .routers.workspaces import DEFAULT_STATES

PEOPLE = [
    ("demo@kairos.dev", "May Cohen", "#3d6e6a", 5),
    ("dor@kairos.dev", "Dor Levi", "#9a5b43", 4),
    ("noa@kairos.dev", "Noa Katz", "#5a7a4a", 4),
    ("amit@kairos.dev", "Amit Ben-David", "#a0702a", 3),
]

# (title, state, points, priority, assignee idx, label, sprint: 'past'|'active'|None, start offset, due offset)
LAUNCH = [
    ("Define MVP scope and success metrics", "Done", 2, "high", 0, "Product", "past", -26, -22),
    ("Design system: colors, type, spacing tokens", "Done", 3, "medium", 2, "Design", "past", -25, -20),
    ("Database schema for orgs, users, billing", "Done", 5, "high", 1, "Backend", "past", -24, -18),
    ("Auth: email + password with JWT", "Done", 3, "high", 1, "Backend", "past", -17, -15),
    ("Marketing site wireframes", "Done", 2, "low", 2, "Design", "past", -19, -15),
    ("CI pipeline with tests and lint", "Done", 2, "medium", 3, "DevOps", "past", -18, -14),
    ("Onboarding flow UI", "Done", 5, "high", 2, "Frontend", "active", -13, -6),
    ("Stripe subscription checkout", "In review", 5, "urgent", 1, "Backend", "active", -10, -2),
    ("Usage metering service", "In progress", 8, "high", 1, "Backend", "active", -8, 3),
    ("Billing settings page", "In progress", 3, "medium", 2, "Frontend", "active", -4, 4),
    ("Invoice PDF generation", "To do", 3, "medium", 3, "Backend", "active", 0, 5),
    ("Email notifications (welcome, receipts)", "To do", 2, "low", 0, "Backend", "active", 1, 6),
    ("Load test checkout path", "To do", 3, "high", 3, "DevOps", "active", 3, 7),
    ("Production deploy on Kubernetes", "To do", 5, "urgent", 3, "DevOps", None, 9, 11),
    ("Public launch announcement", "Backlog", 1, "medium", 0, "Product", None, 9, 12),
    ("Team invitations and roles", "Backlog", 5, "medium", None, "Backend", None, None, None),
    ("Dark mode", "Backlog", 2, "low", 2, "Frontend", None, None, None),
    ("Admin analytics dashboard", "Backlog", None, "none", None, "Frontend", None, None, None),
    ("Audit logs export", "Cancelled", 3, "low", None, "Backend", None, None, None),
]
LAUNCH_DEPS = [  # blocker -> blocked (1-based task numbers)
    (3, 4), (2, 7), (4, 8), (3, 9), (8, 10), (9, 11), (8, 13), (11, 14), (13, 14), (14, 15), (8, 12),
]

MOBILE = [
    ("User research interviews (8 users)", "Done", 3, "high", 0, "Research", -20),
    ("Information architecture", "Done", 2, "medium", 2, "Design", -15),
    ("Interview synthesis and opportunity map", "In progress", 3, "high", 0, "Research", None),
    ("Clickable prototype in Figma", "In progress", 5, "high", 2, "Design", None),
    ("React Native project setup", "To do", 2, "medium", 3, "Mobile", None),
    ("Offline sync strategy spike", "Backlog", 3, "high", 1, "Mobile", None),
    ("Push notifications", "Backlog", 3, "low", None, "Mobile", None),
]

# Written the way a team would actually write them: context, the decision, and what "done" means.
DESCRIPTIONS = {
    "Stripe subscription checkout": (
        "Monthly and annual plans through Stripe Checkout, with the customer portal for card changes.\n\n"
        "Done when:\n- A test card can subscribe to either plan and lands back on /billing\n"
        "- `checkout.session.completed` creates the subscription row exactly once (webhook is idempotent)\n"
        "- Failed 3-D Secure shows the retry message from the copy doc"),
    "Usage metering service": (
        "Count billable events per workspace and report them to Stripe hourly.\n\n"
        "Batch window is 60 minutes for now. @may to sign off before we lock it, because shorter windows "
        "raise our Stripe API volume about 4x.\n\n"
        "Done when:\n- Events are deduplicated by `event_id`\n- A replay of yesterday's log produces the same totals"),
    "Billing settings page": (
        "Plan, next invoice date, payment method and invoice history on one page. Waits on checkout so the "
        "portal link is real.\n\nDesign: Billing v3 frame. Empty state for workspaces on the free tier."),
    "Invoice PDF generation": (
        "Render invoices from the Stripe invoice object. Needs our legal entity, VAT number and the line items "
        "from metering, so it starts after metering lands.\n\nKeep the template in `billing/templates/invoice.html`."),
    "Email notifications (welcome, receipts)": (
        "Welcome email on signup and a receipt on every paid invoice. Plain text first, HTML later.\n\n"
        "Sender: billing@ with a reply-to that reaches support."),
    "Load test checkout path": (
        "k6 script against staging: 200 concurrent checkouts for 10 minutes.\n\n"
        "Pass if p95 stays under 800 ms and no webhook is processed twice."),
    "Production deploy on Kubernetes": (
        "Two replicas behind the ingress, Postgres on the managed instance, secrets from the vault.\n\n"
        "The rollback plan goes in the runbook before the first deploy."),
    "Public launch announcement": (
        "Blog post, changelog entry and the email to the waitlist (about 1,900 people). "
        "Goes out the morning after production is stable for 48 hours."),
    "Team invitations and roles": (
        "Invite by email, accept with a magic link. Roles: owner, admin, member. "
        "Billing pages are owner-only."),
    "Dark mode": "Follow the OS setting by default, with a toggle in the account menu. Charts need their own palette.",
    "Admin analytics dashboard": "Not scoped yet. Talk to sales about which numbers they ask for every week.",
}

LABEL_COLORS = {
    "Product": "#6e5470", "Design": "#9a5b43", "Backend": "#4a6378", "Frontend": "#5a7a4a",
    "DevOps": "#a0702a", "Research": "#3d6e6a", "Mobile": "#77736a",
}


def _dt(d: date, hour: int = 15) -> datetime:
    return datetime(d.year, d.month, d.day, hour, random.randint(0, 59))


def _project(db, ws, name, key, color, desc, labels):
    p = Project(workspace=ws, name=name, key=key, color=color, description=desc)
    for i, (n, g, c, wip) in enumerate(DEFAULT_STATES):
        p.states.append(State(name=n, group=g, color=c, position=(i + 1) * 1000, wip_limit=wip))
    for l in labels:
        p.labels.append(Label(name=l, color=LABEL_COLORS[l]))
    db.add(p)
    db.flush()
    return p


def run(today: date | None = None) -> None:
    random.seed(42)
    today = today or date.today()
    Base.metadata.create_all(engine)
    db = SessionLocal()
    old = db.query(Workspace).filter_by(slug="acme").first()
    if old:
        db.delete(old)
        db.commit()
    users = []
    for email, name, color, _ in PEOPLE:
        u = db.query(User).filter_by(email=email).first() or User(email=email, name=name)
        u.name, u.avatar_color, u.password_hash = name, color, hash_password("demo1234")
        db.add(u)
        users.append(u)
    db.flush()

    ws = Workspace(name="Acme Studio", slug="acme")
    for u, (_, _, _, cap) in zip(users, PEOPLE):
        ws.members.append(Membership(user=u, role=Role.owner if u is users[0] else Role.member, weekly_capacity=cap))
    db.add(ws)
    db.flush()

    # ---- Project 1: SaaS launch ------------------------------------------------
    p = _project(db, ws, "Pulse SaaS Launch", "PLS", "#1f4d3a",
                 "Ship the paid tier of Pulse: billing, onboarding and production infra.",
                 ["Product", "Design", "Backend", "Frontend", "DevOps"])
    states = {s.name: s for s in p.states}
    labels = {l.name: l for l in p.labels}
    past = Sprint(project=p, name="Sprint 1: Foundations", goal="Data model, auth and CI in place",
                  start_date=today - timedelta(days=28), end_date=today - timedelta(days=15), status=SprintStatus.closed)
    active = Sprint(project=p, name="Sprint 2: Get paid", goal="A customer can subscribe and be billed",
                    start_date=today - timedelta(days=13), end_date=today + timedelta(days=12), status=SprintStatus.active)
    db.add_all([past, active])
    db.flush()

    tasks = []
    for i, (title, st, pts, prio, who, label, sprint, s_off, d_off) in enumerate(LAUNCH, start=1):
        created = today - timedelta(days=30 - i % 5)
        t = Task(
            project=p, number=i, title=title, state=states[st], priority=Priority(prio),
            assignee=users[who] if who is not None else None, reporter_id=users[0].id,
            sprint={"past": past, "active": active}.get(sprint), estimate=pts,
            start_date=today + timedelta(days=s_off) if s_off is not None else None,
            due_date=today + timedelta(days=d_off) if d_off is not None else None,
            rank=i * 65536.0, created_at=_dt(created, 9),
            description=DESCRIPTIONS.get(title, ""),
        )
        t.labels = [labels[label]]
        if states[st].group == StateGroup.completed:
            t.completed_at = _dt(today + timedelta(days=d_off or -1))
        db.add(t)
        tasks.append(t)
    p.task_counter = len(tasks)
    db.flush()

    # A few extra completed chores spread over recent weeks to give the forecast real history.
    chores = ["Fix flaky login test", "Upgrade dependencies", "Refactor API error handling", "Add request logging",
              "Seed staging data", "Improve empty states", "Accessibility pass on forms", "Cache pricing table",
              "Tidy env config", "Rate-limit auth endpoints", "Sentry integration", "Optimize bundle size",
              "Webhook retry policy", "Pricing page copy", "Health-check endpoint", "Password reset flow"]
    for j, title in enumerate(chores):
        p.task_counter += 1
        done_on = today - timedelta(days=1 + int(j * 1.6))
        while done_on.weekday() in (5, 6):
            done_on -= timedelta(days=1)
        t = Task(project=p, number=p.task_counter, title=title, state=states["Done"], priority=Priority.low,
                 assignee=users[j % 4], reporter_id=users[0].id, estimate=random.choice([1, 2, 2, 3]),
                 sprint=active if done_on >= active.start_date else past, rank=(100 + j) * 65536.0,
                 created_at=_dt(done_on - timedelta(days=3), 9), completed_at=_dt(done_on))
        t.labels = [labels[random.choice(["Backend", "Frontend", "DevOps"])]]
        db.add(t)
        tasks.append(t)
    db.flush()

    for a, b in LAUNCH_DEPS:
        db.add(Dependency(project_id=p.id, blocker_id=tasks[a - 1].id, blocked_id=tasks[b - 1].id))

    for t in tasks:
        db.add(TaskActivity(project_id=p.id, task_id=t.id, actor_id=users[0].id, verb="created", created_at=t.created_at))
        if t.completed_at:
            db.add(TaskActivity(project_id=p.id, task_id=t.id, actor_id=t.assignee_id, verb="updated", field="state",
                                old_value="In progress", new_value="Done", created_at=t.completed_at))

    conv = [
        (7, 1, "Stripe test keys are in the vault. Webhook secret still missing for staging."),
        (7, 0, "Added it. Please make sure we handle `invoice.payment_failed` too."),
        (8, 3, "Metering writes are ~400/s at peak; batching every 5s keeps Postgres happy."),
        (13, 3, "Blocked until checkout is merged. No point load testing a moving target."),
        (8, 2, "@may can you sign off on the batching window before Friday?"),
    ]
    for k, (idx, who, body) in enumerate(conv):
        c = Comment(task_id=tasks[idx].id, author_id=users[who].id, body=body,
                    created_at=utcnow() - timedelta(hours=30 - k * 6))
        db.add(c)

    # ---- Inbox for the demo user ------------------------------------------------
    db.flush()
    inbox = [
        (2, 8, NotificationKind.mentioned, 'Noa Katz mentioned you on {key}: "@may can you sign off on the batching window before Friday?"', 2, False),
        (3, 13, NotificationKind.commented, 'Amit Ben-David commented on {key}: "Blocked until checkout is merged. No point load testing a moving target."', 8, False),
        (1, 7, NotificationKind.status, "Dor Levi moved {key} to In review", 20, False),
        (1, 9, NotificationKind.assigned, "Dor Levi assigned you {key}: {title}", 28, True),
    ]
    for actor, idx, kind, text, hours, read in inbox:
        t = tasks[idx]
        db.add(Notification(user_id=users[0].id, actor_id=users[actor].id, project_id=p.id, task_id=t.id, kind=kind,
                            text=text.format(key=f"{p.key}-{t.number}", title=t.title),
                            created_at=utcnow() - timedelta(hours=hours),
                            read_at=utcnow() if read else None))

    # ---- Project 2: Mobile app ------------------------------------------------
    m = _project(db, ws, "Mobile App Discovery", "MOB", "#a0702a",
                 "Research and prototype the companion mobile app.", ["Research", "Design", "Mobile"])
    mstates = {s.name: s for s in m.states}
    mlabels = {l.name: l for l in m.labels}
    for i, (title, st, pts, prio, who, label, done_off) in enumerate(MOBILE, start=1):
        t = Task(project=m, number=i, title=title, state=mstates[st], priority=Priority(prio), estimate=pts,
                 assignee=users[who] if who is not None else None, reporter_id=users[0].id, rank=i * 65536.0,
                 created_at=_dt(today - timedelta(days=25), 9),
                 completed_at=_dt(today + timedelta(days=done_off)) if done_off else None)
        t.labels = [mlabels[label]]
        db.add(t)
    m.task_counter = len(MOBILE)

    db.commit()
    db.close()
    print("Seeded workspace 'acme'. Login: demo@kairos.dev / demo1234")


if __name__ == "__main__":
    run()
