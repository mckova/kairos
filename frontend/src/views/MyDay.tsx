import { AlertTriangle, ListOrdered, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { Avatar } from "../components/Avatar";
import { PriorityIcon, StateIcon } from "../components/Icons";
import type { DayPlan, MyTask, Notification, User } from "../types";
import { ago, fmtDate, plural } from "../util";

/** Personal home: an ordered plan for today, everything assigned to me across projects, and the inbox. */
export function MyDay({ me, inbox, onInbox, openTask }: {
  me: User; inbox: { unread: number; items: Notification[] }; onInbox: () => void; openTask: (pid: number, tid: number) => void;
}) {
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  useEffect(() => { api<MyTask[]>("/api/me/tasks").then(setTasks).catch(() => setTasks([])); }, [inbox.items[0]?.id]);

  const makePlan = async () => {
    setPlanning(true); setErr("");
    try { setPlan(await api<DayPlan>("/api/me/ai/plan", { method: "POST" })); }
    catch (e) { setErr(e instanceof ApiError && e.status === 503 ? `${e.message}. Your tasks and inbox below still work.` : (e as Error).message); }
    finally { setPlanning(false); }
  };
  const read = async (ids?: number[]) => { await api("/api/me/notifications/read", { method: "POST", json: { ids: ids ?? null } }); onInbox(); };
  const open = (n: Notification) => { if (!n.read) read([n.id]); openTask(n.project_id, n.task_id); };

  const now = new Date();
  const groups: [string, MyTask[]][] = tasks ? [
    ["In progress", tasks.filter((t) => t.state_group === "started")],
    ["Up next", tasks.filter((t) => t.state_group !== "started")],
  ] : [];
  const items = filter === "unread" ? inbox.items.filter((n) => !n.read) : inbox.items;
  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;
  const blocked = tasks?.filter((t) => t.blocked).length ?? 0;

  return (
    <div className="sheet myday">
      <header className="page-head">
        <div className="headline">
          <div className="headline-main">
          <p className="kicker">{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>{tasks
            ? <>{me.name.split(" ")[0]}, you have <em>{plural(tasks.length, "open task")}</em>. {overdue ? <span className="late">{overdue} overdue</span> : "Nothing overdue"}{blocked ? `, ${blocked} waiting on someone else` : ""}.</>
            : "Loading your work"}</h1>
          </div>
        </div>
      </header>
      <div className="myday-grid">
        <section className="day-panel" aria-label="Plan and tasks">
          <div className="plan-block">
            <div className="plan-head">
              <h2>Today's plan</h2>
              <span className="spacer" />
              <button className={plan ? "" : "primary"} onClick={makePlan} disabled={planning} title="Claude orders your open work using due dates, priority, blockers and unread notifications">
                <ListOrdered className="i" aria-hidden />{planning ? "Planning" : plan ? "Plan again" : "Plan my day"}
              </button>
            </div>
            {err && <div className="error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
            {planning && <div className="thinking" role="status" aria-label="Planning"><span /><span /><span /></div>}
            {plan && !planning && (
              <div className="plan-body">
                <p className="headline">{plan.headline}</p>
                <ol className="focus">
                  {plan.focus.map((f) => (
                    <li key={f.task_id}>
                      <button className="row-btn" onClick={() => openTask(f.project_id, f.task_id)}>
                        <span><span className="key">{f.key}</span> <b>{f.title}</b> <span className="faint">{f.project_name}</span>
                          <div className="reason">{f.reason}</div></span>
                      </button>
                    </li>
                  ))}
                </ol>
                {!!plan.heads_up.length && <ul className="heads">{plan.heads_up.map((h, i) => <li key={i}><AlertTriangle className="i sm" aria-hidden />{h}</li>)}</ul>}
                {plan.inbox_summary && <p className="inbox-sum">{plan.inbox_summary}</p>}
              </div>
            )}
            {!plan && !planning && !err && <p className="plan-empty">Claude reads your open tasks, their deadlines and blockers, and what landed in your inbox, then gives you an order to work in with a reason for each pick.</p>}
          </div>

          {!tasks && <div className="mywork" aria-busy="true">{[70, 55, 80].map((w) => <div key={w} className="skeleton" style={{ width: `${w}%`, margin: "16px 0" }} />)}</div>}
          {groups.map(([title, list]) => (
            <div key={title} className="mywork">
              <h3>{title} <small>{list.length}</small></h3>
              {!list.length ? <p className="my-empty">{title === "In progress" ? "Nothing started. Pick the first task from Up next." : "Nothing else is assigned to you."}</p> : (
                <div className="my-rows">
                  {list.map((t) => (
                    <button key={t.id} className="row-btn my-row" onClick={() => openTask(t.project_id, t.id)}>
                      <StateIcon group={t.state_group} title={t.state} />
                      <PriorityIcon priority={t.priority} />
                      <span className="key">{t.key}</span>
                      <span className="grow">{t.title}</span>
                      {t.blocked && <span className="flag risk"><Lock className="i sm" aria-hidden />Blocked</span>}
                      <span className="proj">{t.project_name}</span>
                      <span className={`due${t.overdue ? " overdue" : ""}`}>{t.due_date ? fmtDate(t.due_date) : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>

        <aside className="inbox" aria-label="Inbox">
          <div className="inbox-head">
            <h2>Inbox</h2><span className="n">{inbox.unread > 0 ? `${inbox.unread} unread` : ""}</span>
            <span className="spacer" />
            <div className="seg" role="group" aria-label="Show">
              <button className={filter === "unread" ? "on" : ""} aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread</button>
              <button className={filter === "all" ? "on" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            </div>
          </div>
          <div className="inbox-list">
            {!items.length && <p className="empty-inbox">{filter === "unread" ? "Nothing unread." : "Assignments, @mentions, comments and status changes on your work will show up here."}</p>}
            {items.map((n) => (
              <button key={n.id} className={`row-btn note${n.read ? "" : " unread"}`} onClick={() => open(n)}>
                <span className={n.read ? "read-dot" : "unread-dot"} aria-hidden="true" />
                <Avatar user={n.actor} size={22} />
                <span style={{ minWidth: 0 }}>
                  <p className="note-text">{n.text}{!n.read && <span className="sr-only"> (unread)</span>}</p>
                  <span className="note-meta"><span>{n.task_key}</span><span>{ago(n.created_at)}</span></span>
                </span>
              </button>
            ))}
          </div>
          {inbox.unread > 0 && <button className="ghost small" style={{ marginTop: 8 }} onClick={() => read()}>Mark all as read</button>}
        </aside>
      </div>
    </div>
  );
}
