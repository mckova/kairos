import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { Avatar } from "../components/Avatar";
import { Bars, Gauge } from "../components/Charts";
import { useStore } from "../store";
import type { Activity } from "../types";
import { PRIORITY, ago, fmtDate, pressable } from "../util";

interface Summary {
  tasks_total: number; by_group: Record<string, number>; by_state: Record<string, number>; open_by_priority: Record<string, number>;
  scope_points: number; done_points: number; completion: number; overdue: number;
  weekly_throughput: { week_ending: string; points: number }[]; avg_lead_time_days: number | null;
}
interface Risk { kind: string; severity: "high" | "medium" | "low"; task_id: number | null; key: string | null; message: string; action: string }
interface Forecast { probability_on_time: number | null; p50: string | null; p85: string | null; remaining_points: number; basis: string }

const SEV_ICON = { high: "🔴", medium: "🟠", low: "🟡" };

export function Insights() {
  const s = useStore();
  const [sum, setSum] = useState<Summary | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [proj, setProj] = useState<Forecast | null>(null);
  const base = `/api/projects/${s.project.id}`;
  useEffect(() => {
    api<Summary>(`${base}/analytics/summary`).then(setSum);
    api<{ findings: Risk[] }>(`${base}/analytics/risks`).then((r) => setRisks(r.findings));
    api<Activity[]>(`${base}/activity${qs({ limit: 25 })}`).then(setFeed);
    api<Forecast>(`${base}/analytics/forecast${qs({ scope: "project" })}`).then(setProj).catch(() => setProj(null));
  }, [s.project.id, s.version]);
  if (!sum) return <div className="loading">Crunching numbers…</div>;
  const taskKey = (id: number) => s.tasks.find((t) => t.id === id)?.key ?? `#${id}`;
  const maxPrio = Math.max(1, ...Object.values(sum.open_by_priority));

  return (
    <div className="insights">
      <div className="kpis">
        <div className="kpi"><small>Completion</small><b>{Math.round(sum.completion * 100)}%</b><div className="bar-track"><div style={{ width: `${sum.completion * 100}%` }} /></div><span className="muted">{sum.done_points}/{sum.scope_points} pts</span></div>
        <div className="kpi"><small>Open tasks</small><b>{sum.tasks_total - (sum.by_group.completed ?? 0) - (sum.by_group.cancelled ?? 0)}</b><span className="muted">{sum.by_group.started ?? 0} in progress</span></div>
        <div className="kpi"><small>Overdue</small><b className={sum.overdue ? "overdue" : ""}>{sum.overdue}</b></div>
        <div className="kpi"><small>Avg lead time</small><b>{sum.avg_lead_time_days ?? "–"}</b><span className="muted">days, created → done</span></div>
        <div className="kpi"><small>Whole backlog done by</small><b>{fmtDate(proj?.p85)}</b><span className="muted">85% confidence</span></div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Risk radar <small className="muted">{risks.length} findings</small></h3>
          <ul className="risks">
            {risks.map((r, i) => (
              <li key={i} className={r.severity} {...(r.task_id ? pressable(() => s.openTask(r.task_id!)) : {})}>
                <span>{SEV_ICON[r.severity]}</span>
                <div><b>{r.message}</b><small>{r.action}</small></div>
              </li>
            ))}
            {!risks.length && <li className="ok">✅ No risks detected - nice work.</li>}
          </ul>
        </div>
        <div className="panel">
          <h3>Weekly throughput <small className="muted">points completed</small></h3>
          <Bars data={sum.weekly_throughput.map((w) => ({ label: fmtDate(w.week_ending), value: w.points }))} />
          <div className="split">
            <div>
              <h4>Open work by priority</h4>
              {Object.entries(PRIORITY).map(([k, v]) => (
                <div key={k} className="hbar"><span>{v.label}</span><div><i style={{ width: `${((sum.open_by_priority[k] ?? 0) / maxPrio) * 100}%`, background: v.color }} /></div><b>{sum.open_by_priority[k] ?? 0}</b></div>
              ))}
            </div>
            <div className="center"><Gauge value={sum.completion} label="scope done" /></div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3>Flow by status</h3>
          {s.project.states.map((st) => {
            const n = sum.by_state[String(st.id)] ?? 0;
            return <div key={st.id} className="hbar"><span>{st.name}</span><div><i style={{ width: `${(n / Math.max(sum.tasks_total, 1)) * 100}%`, background: st.color }} /></div><b>{n}</b></div>;
          })}
        </div>
        <div className="panel">
          <h3>Recent activity</h3>
          <ul className="activity feed">
            {feed.map((a) => (
              <li key={a.id} {...pressable(() => s.openTask(a.task_id))}>
                <Avatar user={a.actor} size={18} />
                <span><b>{a.actor?.name ?? "System"}</b> {a.verb === "updated" ? `changed ${a.field}${a.field === "state" ? ` → ${a.new_value}` : ""}` : a.verb} on <span className="key">{taskKey(a.task_id)}</span> <small>{ago(a.created_at)}</small></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
