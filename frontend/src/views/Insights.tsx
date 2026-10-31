import { useEffect, useState } from "react";
import { api, qs } from "../api";
import { Avatar } from "../components/Avatar";
import { Composition, WeekBars } from "../components/Charts";
import { useStore } from "../store";
import type { Activity } from "../types";
import { PRIORITY, ago, fmtDate, plural, pressable } from "../util";

interface Summary {
  tasks_total: number; by_group: Record<string, number>; by_state: Record<string, number>; open_by_priority: Record<string, number>;
  scope_points: number; done_points: number; completion: number; overdue: number;
  weekly_throughput: { week_ending: string; points: number }[]; avg_lead_time_days: number | null;
}
interface Risk { kind: string; severity: "high" | "medium" | "low"; task_id: number | null; key: string | null; message: string; action: string }
interface Forecast { probability_on_time: number | null; p50: string | null; p85: string | null; remaining_points: number; basis: string }

/** Priority is ordered, so it reads as one hue from strong to faint rather than five colours. */
const PRIO_SHADES = ["var(--accent)", "color-mix(in srgb, var(--accent) 72%, var(--sheet-solid))", "color-mix(in srgb, var(--accent) 48%, var(--sheet-solid))", "color-mix(in srgb, var(--accent) 28%, var(--sheet-solid))", "hatch"];
/** Status follows the workflow left to right, so it uses the same ramp: faint for not started, full Harbor for done. */
const stateShade = (group: string, name: string) =>
  group === "completed" ? PRIO_SHADES[0] : group === "started" ? (/review/i.test(name) ? PRIO_SHADES[1] : PRIO_SHADES[2]) : group === "unstarted" ? PRIO_SHADES[3] : "hatch";

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
  if (!sum) return <div className="loading" aria-busy="true">Loading insights</div>;
  const taskKey = (id: number) => s.tasks.find((t) => t.id === id)?.key ?? `#${id}`;
  const open = sum.tasks_total - (sum.by_group.completed ?? 0) - (sum.by_group.cancelled ?? 0);
  const high = risks.filter((r) => r.severity === "high").length;
  const pct = Math.round(sum.completion * 100);

  return (
    <div className="insights">
      <p className="statement">
        {proj?.p85 ? <>The remaining backlog lands by <b>{fmtDate(proj.p85, { day: "numeric", month: "long" })}</b> with 85% confidence. </> : <>Not enough completed work yet to forecast a finish date. </>}
        {pct}% of scope is done{sum.overdue ? <>, and <b>{plural(sum.overdue, "task")}</b> {sum.overdue === 1 ? "is" : "are"} overdue</> : ""}.
        {high > 0 && <> {plural(high, "risk")} need{high === 1 ? "s" : ""} attention today.</>}
      </p>
      <div className="ledger">
        <div className="meter" role="img" aria-label={`${pct}% of points done`}><i style={{ width: `${pct}%` }} /></div>
        <p>
          <span><b>{sum.done_points}</b> of {sum.scope_points} points done</span>
          <span><b>{open}</b> open, {sum.by_group.started ?? 0} in progress</span>
          <span>Lead time <b>{sum.avg_lead_time_days ?? "n/a"}</b> days</span>
          {proj?.p50 && <span>Even odds by <b>{fmtDate(proj.p50)}</b></span>}
        </p>
      </div>

      <div className="grid-3-2 section">
        <section>
          <h3>Risks <small>{risks.length ? `${risks.length} found, worst first` : "none"}</small></h3>
          <ul className="risks">
            {risks.map((r, i) => (
              <li key={i} className={r.severity} {...(r.task_id ? pressable(() => s.openTask(r.task_id!)) : {})}>
                <span className="sev" aria-label={`${r.severity} severity`} />
                <div><b>{r.message}</b><small>{r.action}</small></div>
              </li>
            ))}
            {!risks.length && <li className="ok"><span className="sev" /><div>Nothing overdue, blocked or over capacity.</div></li>}
          </ul>
        </section>
        <section>
          <h3>Completed per week <small>story points</small></h3>
          <WeekBars data={sum.weekly_throughput.slice(Math.max(0, Math.min(sum.weekly_throughput.findIndex((w) => w.points > 0), sum.weekly_throughput.length - 4))).map((w) => ({ label: fmtDate(w.week_ending), value: w.points }))} />
          <h3 style={{ marginTop: 28 }}>Open work by priority</h3>
          <Composition centre="open tasks" label="Open work by priority" parts={Object.entries(PRIORITY).map(([k, v], i) => ({ key: k, label: v.label, value: sum.open_by_priority[k] ?? 0, color: PRIO_SHADES[i] }))} />
        </section>
      </div>

      <div className="grid-3-2 section">
        <section>
          <h3>Recent activity</h3>
          <ul className="activity feed">
            {feed.map((a) => (
              <li key={a.id} {...pressable(() => s.openTask(a.task_id))}>
                <Avatar user={a.actor} size={18} />
                <span><b>{a.actor?.name ?? "System"}</b> {a.verb === "updated" ? (a.field === "state" ? `moved ${taskKey(a.task_id)} to ${a.new_value}` : `changed ${a.field} on ${taskKey(a.task_id)}`) : a.verb === "created" ? `created ${taskKey(a.task_id)}` : `${a.verb} on ${taskKey(a.task_id)}`}<small>{ago(a.created_at)}</small></span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Tasks by status</h3>
          <Composition centre="tasks" label="Tasks by status" parts={s.project.states.map((st) => ({ key: String(st.id), label: st.name, value: sum.by_state[String(st.id)] ?? 0, color: stateShade(st.group, st.name) }))} />
        </section>
      </div>
    </div>
  );
}
