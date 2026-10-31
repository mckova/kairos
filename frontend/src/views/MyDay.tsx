import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { Avatar } from "../components/Avatar";
import type { DayPlan, MyTask, Notification, User } from "../types";
import { PRIORITY, ago, fmtDate } from "../util";

const KIND_ICON: Record<Notification["kind"], string> = { assigned: "👤", mentioned: "@", commented: "💬", status: "⇢" };

/** Personal home: AI plan for today, everything assigned to me across projects, and the inbox. */
export function MyDay({ me, inbox, onInbox, openTask }: {
  me: User; inbox: { unread: number; items: Notification[] }; onInbox: () => void; openTask: (pid: number, tid: number) => void;
}) {
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("unread");

  useEffect(() => { api<MyTask[]>("/api/me/tasks").then(setTasks); }, [inbox.items[0]?.id]);

  const makePlan = async () => {
    setPlanning(true); setErr("");
    try { setPlan(await api<DayPlan>("/api/me/ai/plan", { method: "POST" })); }
    catch (e) { setErr(e instanceof ApiError && e.status === 503 ? `${e.message}. Everything else works without AI.` : (e as Error).message); }
    finally { setPlanning(false); }
  };
  const read = async (ids?: number[]) => { await api("/api/me/notifications/read", { method: "POST", json: { ids: ids ?? null } }); onInbox(); };
  const open = (n: Notification) => { if (!n.read) read([n.id]); openTask(n.project_id, n.task_id); };

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const groups: [string, MyTask[]][] = tasks ? [
    ["In progress", tasks.filter((t) => t.state_group === "started")],
    ["Up next", tasks.filter((t) => t.state_group !== "started")],
  ] : [];
  const items = filter === "unread" ? inbox.items.filter((n) => !n.read) : inbox.items;
  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;
  const blocked = tasks?.filter((t) => t.blocked).length ?? 0;

  return (
    <div className="myday">
      <header className="page-head">
        <div>
          <h1>{greet}, {me.name.split(" ")[0]}</h1>
          <p className="muted">{tasks ? `${tasks.length} open tasks across your projects · ${overdue} overdue · ${blocked} blocked · ${inbox.unread} unread` : "Loading…"}</p>
        </div>
      </header>
      <div className="myday-grid">
        <section>
          <div className="card plan">
            <div className="plan-head">
              <span className="spark">✦</span><b>Plan my day</b>
              <small className="muted">Claude reads your tasks, deadlines, blockers and inbox</small>
              <span className="spacer" />
              <button className="ai-btn" onClick={makePlan} disabled={planning}>{planning ? "Planning…" : plan ? "Re-plan" : "✦ Generate plan"}</button>
            </div>
            {err && <div className="error">{err}</div>}
            {planning && <div className="bubble assistant thinking" role="status" aria-label="Planning"><span /><span /><span /></div>}
            {plan && !planning && (
              <div className="plan-body">
                <p className="headline">{plan.headline}</p>
                <ol className="focus">
                  {plan.focus.map((f) => (
                    <li key={f.task_id}>
                      <button className="row-btn" onClick={() => openTask(f.project_id, f.task_id)}>
                        <span className="key">{f.key}</span> <b>{f.title}</b><small className="muted"> · {f.project_name}</small>
                        <div className="reason">{f.reason}</div>
                      </button>
                    </li>
                  ))}
                </ol>
                {!!plan.heads_up.length && <><h4>Heads-up</h4><ul className="heads">{plan.heads_up.map((h, i) => <li key={i}>⚠ {h}</li>)}</ul></>}
                {plan.inbox_summary && <p className="muted inbox-sum">📥 {plan.inbox_summary}</p>}
              </div>
            )}
            {!plan && !planning && !err && <p className="muted">One click turns your open work into an ordered plan for today, with the reason for each pick.</p>}
          </div>

          {!tasks && <div className="card" aria-busy="true">{[70, 55, 80, 40].map((w) => <div key={w} className="skeleton" style={{ width: `${w}%`, margin: "10px 0" }} />)}</div>}
          {groups.map(([title, list]) => (
            <div key={title} className="card">
              <h3>{title} <small className="muted">{list.length}</small></h3>
              {!list.length && <p className="muted">{title === "In progress" ? "Nothing in progress. Pick one from Up next, or let the AI plan your day." : "Nothing queued for you. Press Ctrl K to find work or ask the AI."}</p>}
              {list.map((t) => (
                <button key={t.id} className="row-btn my-row" onClick={() => openTask(t.project_id, t.id)}>
                  <span title={PRIORITY[t.priority].label} aria-label={`${PRIORITY[t.priority].label} priority`}>{PRIORITY[t.priority].icon}</span>
                  <span className="key">{t.key}</span>
                  <span className="grow">{t.title}</span>
                  {t.blocked && <span className="chip warn">blocked</span>}
                  <span className="chip" style={{ "--c": t.project_color } as React.CSSProperties}>{t.project_name}</span>
                  <small className="muted">{t.state}</small>
                  {t.due_date && <small className={t.overdue ? "overdue" : "muted"}>{fmtDate(t.due_date)}</small>}
                  <span className="pts">{t.estimate ?? "?"}</span>
                </button>
              ))}
            </div>
          ))}
        </section>

        <aside className="card inbox">
          <div className="inbox-head">
            <h3>Inbox {inbox.unread > 0 && <span className="badge">{inbox.unread}</span>}</h3>
            <span className="spacer" />
            <div className="seg">
              <button className={filter === "unread" ? "on" : ""} onClick={() => setFilter("unread")}>Unread</button>
              <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
            </div>
            {inbox.unread > 0 && <button className="ghost" onClick={() => read()}>Mark all read</button>}
          </div>
          {!items.length && <p className="muted empty-inbox">{filter === "unread" ? "You're all caught up." : "No notifications yet. You'll hear about assignments, @mentions, comments and status changes on your work."}</p>}
          {items.map((n) => (
            <button key={n.id} className={`row-btn note${n.read ? "" : " unread"}`} onClick={() => open(n)}>
              <div className="note-ico" aria-hidden="true">{n.actor ? <Avatar user={n.actor} size={26} /> : KIND_ICON[n.kind]}<span className="kind">{KIND_ICON[n.kind]}</span></div>
              <div><p>{n.text}{!n.read && <span className="sr-only"> (unread)</span>}</p><small className="muted">{ago(n.created_at)}</small></div>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
