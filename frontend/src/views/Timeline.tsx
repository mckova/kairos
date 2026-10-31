import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { addDays, daysBetween, fmtDate, today } from "../util";

interface CPNode { task_id: number; earliest_start: string; earliest_finish: string; slack_days: number; critical: boolean }
interface CP { chain: string[]; chain_ids: number[]; projected_finish: string; length_days: number; nodes: CPNode[] }

const DAY = 28, ROW = 34, LEFT = 260;

/** Gantt timeline: planned bars (dates), auto-scheduled bars (CPM) for undated work, dependency arrows, critical path. */
export function Timeline() {
  const s = useStore();
  const [cp, setCp] = useState<CP | null>(null);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { api<CP>(`/api/projects/${s.project.id}/analytics/critical-path`).then(setCp).catch(() => setCp(null)); }, [s.project.id, s.version]);

  const nodeOf = useMemo(() => new Map(cp?.nodes.map((n) => [n.task_id, n]) ?? []), [cp]);
  const groupOf = (stateId: number) => s.project.states.find((x) => x.id === stateId)!.group;

  const rows = useMemo(() => {
    return s.visible
      .filter((t) => groupOf(t.state_id) !== "cancelled")
      .map((t) => {
        const n = nodeOf.get(t.id);
        const done = groupOf(t.state_id) === "completed";
        let start = t.start_date, end = t.due_date, planned = true;
        if (!start && end) start = addDays(end, -Math.max(Math.ceil(t.estimate ?? 1) - 1, 0));
        if (start && !end) end = addDays(start, Math.max(Math.ceil(t.estimate ?? 1) - 1, 0));
        if (!start && n && !done) { start = n.earliest_start; end = n.earliest_finish; planned = false; }
        if (!start && done && t.completed_at) { end = t.completed_at.slice(0, 10); start = addDays(end, -Math.max(Math.ceil(t.estimate ?? 1) - 1, 0)); }
        return { t, start, end, planned, done, critical: !!n?.critical && !done, slack: n?.slack_days };
      })
      .filter((r) => r.start && r.end && (!onlyCritical || r.critical) && (showDone || !r.done))
      .sort((a, b) => (a.start! < b.start! ? -1 : a.start! > b.start! ? 1 : a.t.number - b.t.number));
  }, [s.visible, nodeOf, onlyCritical, showDone]);

  useEffect(() => {
    const el = scroller.current, mark = el?.querySelector(".today");
    if (el && mark) el.scrollLeft = Math.max(0, +(mark.getAttribute("x1") ?? 0) - el.clientWidth / 3);
  }, [rows.length > 0, showDone]);

  if (!rows.length) return <div className="empty big">Add start or due dates (or dependencies + estimates) to see the timeline.</div>;
  const t0 = addDays(rows.reduce((m, r) => (r.start! < m ? r.start! : m), today()), -2);
  const t1 = addDays(rows.reduce((m, r) => (r.end! > m ? r.end! : m), cp?.projected_finish ?? today()), 3);
  const days = daysBetween(t0, t1) + 1;
  const x = (d: string) => LEFT + daysBetween(t0, d) * DAY;
  const W = LEFT + days * DAY, H = 40 + rows.length * ROW;
  const index = new Map(rows.map((r, i) => [r.t.id, i]));
  const yMid = (i: number) => 40 + i * ROW + ROW / 2;

  return (
    <div className="timeline-wrap">
      <div className="timeline-bar">
        {cp && <span>Critical path: <b>{cp.chain.join(" → ") || "—"}</b> · remaining {cp.length_days} working days · projected finish <b>{fmtDate(cp.projected_finish, { day: "numeric", month: "short", year: "numeric" })}</b></span>}
        <span className="spacer" />
        <label className="toggle-row"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
        <label className="toggle-row"><input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} /> Critical only</label>
        <span className="legend"><i className="lg planned" />planned <i className="lg auto" />auto-scheduled <i className="lg crit" />critical <i className="lg done" />done <i className="lg late" />date conflict</span>
      </div>
      <div className="timeline-scroll" ref={scroller}>
        <svg width={W} height={H} className="gantt">
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" className="arrow-head" /></marker></defs>
          {Array.from({ length: days }, (_, i) => {
            const d = addDays(t0, i), dow = new Date(d + "T00:00:00").getDay();
            return (
              <g key={d}>
                {(dow === 0 || dow === 6) && <rect x={LEFT + i * DAY} y={0} width={DAY} height={H} className="weekend" />}
                {dow === 1 && <text x={LEFT + i * DAY + 3} y={16} className="axis">{fmtDate(d)}</text>}
                <text x={LEFT + i * DAY + DAY / 2} y={32} textAnchor="middle" className="axis tiny">{new Date(d + "T00:00:00").getDate()}</text>
              </g>
            );
          })}
          <line x1={x(today()) + DAY / 2} x2={x(today()) + DAY / 2} y1={20} y2={H} className="today" />
          {rows.map((r, i) => (
            <g key={r.t.id} className="g-row" onClick={() => s.openTask(r.t.id)}>
              <rect x={0} y={40 + i * ROW} width={W} height={ROW} className={i % 2 ? "stripe" : "stripe alt"} />
              <text x={10} y={yMid(i) + 4} className="g-key">{r.t.key}</text>
              <text x={70} y={yMid(i) + 4} className="g-title">{r.t.title.length > 26 ? r.t.title.slice(0, 25) + "…" : r.t.title}</text>
              <rect x={x(r.start!) + 2} y={40 + i * ROW + 7} width={Math.max((daysBetween(r.start!, r.end!) + 1) * DAY - 4, 8)} height={ROW - 14} rx={6}
                className={`bar${r.done ? " done" : ""}${r.planned ? "" : " auto"}${r.critical ? " crit" : ""}`}>
                <title>{`${r.t.key}: ${fmtDate(r.start)} – ${fmtDate(r.end)}${r.slack != null && !r.done ? ` · slack ${r.slack}d` : ""}`}</title>
              </rect>
            </g>
          ))}
          {s.deps.map((d) => {
            const a = index.get(d.blocker_id), b = index.get(d.blocked_id);
            if (a == null || b == null) return null;
            const ra = rows[a], rb = rows[b];
            const x1 = x(ra.end!) + DAY - 2, y1 = yMid(a), x2 = x(rb.start!) + 2, y2 = yMid(b);
            const mid = Math.max(x1 + 10, Math.min(x2 - 10, x1 + 10));
            const crit = ra.critical && rb.critical;
            return <path key={d.id} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} className={`dep${crit ? " crit" : ""}${x2 < x1 ? " late" : ""}`} markerEnd="url(#arrow)" />;
          })}
        </svg>
      </div>
    </div>
  );
}
