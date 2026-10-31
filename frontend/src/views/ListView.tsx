import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { Task } from "../types";
import { PRIORITY, fmtDate, today, pressable } from "../util";

const GROUP_CLASS: Record<string, string> = { started: "started", completed: "completed", cancelled: "cancelled" };

/** Tasks grouped by status, most urgent first inside each group. Finished work folds away until asked for. */
export function ListView() {
  const s = useStore();
  const [showClosed, setShowClosed] = useState(false);
  const groups = useMemo(() => {
    const order = (a: Task, b: Task) =>
      PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.number - b.number;
    return [...s.project.states]
      .sort((a, b) => a.position - b.position)
      .map((st) => ({ st, rows: s.visible.filter((t) => t.state_id === st.id).sort(order) }))
      .filter((g) => g.rows.length);
  }, [s.visible, s.project.states]);
  const open = groups.filter((g) => !["completed", "cancelled"].includes(g.st.group));
  const closed = groups.filter((g) => ["completed", "cancelled"].includes(g.st.group));
  const closedCount = closed.reduce((n, g) => n + g.rows.length, 0);
  const keyOf = (id: number) => s.tasks.find((t) => t.id === id)?.key;
  const firstName = (id: number | null) => s.userById(id)?.name.split(" ")[0];

  const row = (t: Task, group: string, name: string) => {
    const late = !!t.due_date && t.due_date < today() && !["completed", "cancelled"].includes(group);
    const cls = group === "started" && /review/i.test(name) ? "review" : GROUP_CLASS[group] ?? "";
    const waits = t.blocked_by.length === 1 ? `Waiting on ${keyOf(t.blocked_by[0])}` : t.blocked_by.length > 1 ? `Waiting on ${t.blocked_by.length} tasks` : "";
    return (
      <div key={t.id} className={`lrow${s.openId === t.id ? " sel" : ""}`} {...pressable(() => s.openTask(t.id))} aria-label={`${t.key} ${t.title}`}>
        <span className="k">{t.key}</span>
        <span className="ti">{t.title}</span>
        <span className="dim">{waits}</span>
        <span className={`st ${cls}`}>{name}</span>
        <span className={`due${late ? " late" : ""}`}>{fmtDate(t.due_date)}</span>
        <span className="who">{firstName(t.assignee_id) ?? <span className="faint">Nobody</span>}</span>
      </div>
    );
  };

  if (!groups.length) return <div className="empty big">No tasks match the current filters.</div>;
  return (
    <div className="glist">
      {open.map(({ st, rows }) => (
        <section key={st.id} aria-label={st.name}>
          <h3>{st.name}<span>{rows.length}</span></h3>
          {rows.map((t) => row(t, st.group, st.name))}
        </section>
      ))}
      {closedCount > 0 && (
        <button className="ghost closed-toggle" onClick={() => setShowClosed(!showClosed)} aria-expanded={showClosed}>
          {showClosed ? "Hide finished tasks" : `Show ${closedCount} finished`}
        </button>
      )}
      {showClosed && closed.map(({ st, rows }) => (
        <section key={st.id} aria-label={st.name}>
          <h3>{st.name}<span>{rows.length}</span></h3>
          {rows.map((t) => row(t, st.group, st.name))}
        </section>
      ))}
    </div>
  );
}
