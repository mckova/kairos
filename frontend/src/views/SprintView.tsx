import { Copy, FileText, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { Avatar } from "../components/Avatar";
import { Burndown as BurndownChart, Capacity } from "../components/Charts";
import { Markdown } from "../components/Markdown";
import { useStore } from "../store";
import type { Sprint, Task } from "../types";
import { PRIORITY, addDays, fmtDate, plural, today, pressable } from "../util";

interface Burndown { scope: number; series: { date: string; ideal: number; remaining?: number }[] }
interface Forecast { remaining_points: number; probability_on_time: number | null; p50: string | null; p85: string | null; p95: string | null; basis: string; deadline: string | null }
interface Workload { working_days_left: number; unassigned_points: number; members: { user_id: number; name: string; avatar_color: string; assigned_points: number; capacity_points: number; utilization: number | null }[] }

export function SprintView() {
  const s = useStore();
  const active = s.sprints.find((x) => x.status === "active");
  const [sel, setSel] = useState<number | null>(active?.id ?? s.sprints.at(-1)?.id ?? null);
  const sprint = s.sprints.find((x) => x.id === sel);
  const [bd, setBd] = useState<Burndown | null>(null);
  const [fc, setFc] = useState<Forecast | null>(null);
  const [wl, setWl] = useState<Workload | null>(null);
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const writeReport = async () => {
    if (!sprint) return;
    setWriting(true);
    try { setReport((await api<{ markdown: string }>(`${base}/ai/report`, { method: "POST", json: { sprint_id: sprint.id } })).markdown); }
    catch (e) { s.toast((e as Error).message); } finally { setWriting(false); }
  };
  const base = `/api/projects/${s.project.id}`;

  useEffect(() => { if (!sel && s.sprints.length) setSel(active?.id ?? s.sprints.at(-1)!.id); }, [s.sprints]);
  useEffect(() => {
    if (!sprint) return;
    const q = qs({ sprint_id: sprint.id });
    api<Burndown>(`${base}/analytics/burndown${q}`).then(setBd);
    api<Forecast>(`${base}/analytics/forecast${q}`).then(setFc);
    api<Workload>(`${base}/analytics/workload${q}`).then(setWl);
  }, [sprint?.id, sprint?.status, s.version]);

  const groupOf = (t: Task) => s.project.states.find((x) => x.id === t.state_id)!.group;
  const scope = s.tasks.filter((t) => t.sprint_id === sprint?.id);
  const backlog = s.tasks.filter((t) => !t.sprint_id && !["completed", "cancelled"].includes(groupOf(t)))
    .sort((a, b) => PRIORITY[a.priority].rank - PRIORITY[b.priority].rank);

  const move = async (t: Task, sprint_id: number | null) => {
    try { s.upsert(await api<Task>(`${base}/tasks/${t.id}`, { method: "PATCH", json: { sprint_id } })); }
    catch (e) { s.toast((e as Error).message); }
  };
  const setStatus = async (sp: Sprint, status: Sprint["status"]) => {
    try { await api(`${base}/sprints/${sp.id}`, { method: "PATCH", json: { status } }); await s.reload(); s.toast(`${sp.name} is now ${status}`); }
    catch (e) { s.toast((e as Error).message); }
  };

  const done = scope.filter((t) => groupOf(t) === "completed").reduce((a, t) => a + (t.estimate ?? 1), 0);
  const total = scope.filter((t) => groupOf(t) !== "cancelled").reduce((a, t) => a + (t.estimate ?? 1), 0);

  return (
    <div className="sprint-view">
      <div className="sprint-head">
        <select aria-label="Sprint" value={sel ?? ""} onChange={(e) => setSel(+e.target.value)}>
          {s.sprints.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        {sprint && <span className={`status-word ${sprint.status}`}>{sprint.status}</span>}
        {sprint && <span className="mono faint" style={{ fontSize: 12 }}>{fmtDate(sprint.start_date)} to {fmtDate(sprint.end_date)}</span>}
        <span className="spacer" />
        {sprint?.status === "planned" && <button className="primary" onClick={() => setStatus(sprint, "active")}>Start sprint</button>}
        {sprint?.status === "active" && <button onClick={() => setStatus(sprint, "closed")} title="Unfinished tasks return to the backlog">Complete sprint</button>}
        {sprint && <button onClick={writeReport} disabled={writing} title="Claude writes a stakeholder update from the live burndown, forecast, risks and activity"><FileText className="i" aria-hidden />{writing ? "Writing report" : "Write status report"}</button>}
        <button className="ghost" onClick={() => setCreating(true)}><Plus className="i" aria-hidden />New sprint</button>
      </div>
      {creating && <NewSprint onDone={async () => { setCreating(false); await s.reload(); }} />}
      {!sprint ? <div className="empty big">No sprints yet. Create one to start planning.</div> : (
        <>
          {sprint.goal && <p className="goal">{sprint.goal}</p>}
          {report && (
            <section className="panel report" aria-label="Status report">
              <header><h3>Status report</h3><small className="faint">Written by Claude from this sprint's live data. Check it before sending.</small><span className="spacer" />
                <button className="ghost small" onClick={() => { navigator.clipboard?.writeText(report); s.toast("Report copied"); }}><Copy className="i sm" aria-hidden />Copy</button>
                <button className="ghost icon" aria-label="Close report" onClick={() => setReport(null)}><X className="i sm" /></button></header>
              <Markdown text={report} />
            </section>
          )}
          <p className="ledger-line">
            <span><b>{done}</b> of {total} points done</span>
            <span><b>{scope.length}</b> tasks, {scope.filter((t) => groupOf(t) === "completed").length} done</span>
            <span><b>{wl?.working_days_left ?? "n/a"}</b> working days left</span>
            <span><b>{wl?.unassigned_points ?? 0}</b> points with no owner</span>
          </p>
          <section className="section chart-section">
            <h3>Burndown and forecast</h3>
            {fc && (
              <p className="chart-lede">
                {fc.probability_on_time == null ? "Not enough history to forecast yet." : <><b>{Math.round(fc.probability_on_time * 100)}% chance</b> of finishing by {fmtDate(fc.deadline, { day: "numeric", month: "long" })}. </>}
                {fc.p50 && <>Even odds by <b>{fmtDate(fc.p50)}</b>, 85% likely by <b>{fmtDate(fc.p85)}</b>, 95% by {fmtDate(fc.p95)}.</>}
              </p>
            )}
            <div className="legend"><i className="lg actual" />Days so far <i className="lg proj" />Projected to the likely finish <i className="lg today" />Today</div>
            {bd && <BurndownChart series={bd.series} forecast={fc} />}
            {fc && <p className="fc-basis">{fc.remaining_points} points left. {fc.basis}</p>}
          </section>
          {wl && (
            <section className="section">
              <h3>Capacity <small>open points against what each person can finish before the sprint ends</small></h3>
              <div className="workload">
                {wl.members.map((m) => {
                  const over = Math.round((m.assigned_points - m.capacity_points) * 10) / 10;
                  return (
                    <div key={m.user_id} className="wl-row">
                      <span className="with-avatar"><Avatar user={{ id: m.user_id, name: m.name, avatar_color: m.avatar_color, email: "" }} size={22} />{m.name}</span>
                      <Capacity load={m.assigned_points} capacity={m.capacity_points} />
                      <span>{m.assigned_points} of {m.capacity_points} pt{over > 0 && <em className="over-by"> {over} over</em>}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {sprint.status !== "closed" && (
            <div className="grid-2 section">
              <PlanList title={`In this sprint · ${plural(scope.length, "task")}`} tasks={scope} action="Remove" onAction={(t) => move(t, null)} />
              <PlanList title={`Backlog · ${plural(backlog.length, "task")}`} tasks={backlog} action="Add" onAction={(t) => move(t, sprint.id)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlanList({ title, tasks, action, onAction }: { title: string; tasks: Task[]; action: string; onAction: (t: Task) => void }) {
  const s = useStore();
  return (
    <section>
      <h3>{title}</h3>
      <ul className="plan-list">
        {tasks.map((t) => (
          <li key={t.id}>
            <span className="key">{t.key}</span>
            <span className="plan-title" {...pressable(() => s.openTask(t.id))}>{t.title}</span>
            <span className="pts">{t.estimate != null ? `${t.estimate} pt` : ""}</span>
            <Avatar user={s.userById(t.assignee_id)} size={20} />
            <button className="ghost small" onClick={() => onAction(t)} aria-label={`${action} ${t.key}`}>{action}</button>
          </li>
        ))}
        {!tasks.length && <li className="faint">{action === "Add" ? "Backlog is empty." : "No tasks in this sprint yet. Add some from the backlog."}</li>}
      </ul>
    </section>
  );
}

function NewSprint({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const last = s.sprints.at(-1);
  const start = last && last.end_date >= today() ? addDays(last.end_date, 1) : today();
  const [f, setF] = useState({ name: `Sprint ${s.sprints.length + 1}`, goal: "", start_date: start, end_date: addDays(start, 13) });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(`/api/projects/${s.project.id}/sprints`, { method: "POST", json: f }); onDone(); }
    catch (err) { s.toast((err as Error).message); }
  };
  return (
    <form className="panel inline-form" onSubmit={submit}>
      <input aria-label="Sprint name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sprint name" />
      <input value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} placeholder="What should this sprint achieve?" aria-label="Sprint goal" className="grow" />
      <input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
      <input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} />
      <button className="primary">Create</button>
    </form>
  );
}
