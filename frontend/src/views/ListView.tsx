import { useMemo, useState } from "react";
import { api } from "../api";
import { Avatar } from "../components/Avatar";
import { useStore } from "../store";
import type { Task } from "../types";
import { PRIORITY, fmtDate, today, pressable } from "../util";

type Key = "key" | "title" | "state" | "priority" | "assignee" | "estimate" | "due";

export function ListView() {
  const s = useStore();
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: "priority", dir: 1 });
  const stateOf = (t: Task) => s.project.states.find((x) => x.id === t.state_id)!;
  const rows = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sort.k) {
        case "key": return t.number;
        case "title": return t.title.toLowerCase();
        case "state": return stateOf(t).position;
        case "priority": return PRIORITY[t.priority].rank;
        case "assignee": return s.userById(t.assignee_id)?.name ?? "~";
        case "estimate": return t.estimate ?? -1;
        case "due": return t.due_date ?? "9999";
      }
    };
    return [...s.visible].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [s.visible, sort]);
  const th = (k: Key, label: string) => (
    <th onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })} className={sort.k === k ? "sorted" : ""}>
      {label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
  const patch = async (t: Task, body: Partial<Task>) => {
    try { s.upsert(await api<Task>(`/api/projects/${s.project.id}/tasks/${t.id}`, { method: "PATCH", json: body })); }
    catch (e) { s.toast((e as Error).message); }
  };
  return (
    <div className="table-wrap">
      <table className="list">
        <thead><tr>{th("key", "ID")}{th("title", "Title")}{th("state", "Status")}{th("priority", "Priority")}{th("assignee", "Assignee")}{th("estimate", "Pts")}{th("due", "Due")}<th>Labels</th></tr></thead>
        <tbody>
          {rows.map((t) => {
            const st = stateOf(t);
            const late = t.due_date && t.due_date < today() && !["completed", "cancelled"].includes(st.group);
            return (
              <tr key={t.id} {...pressable(() => s.openTask(t.id))}>
                <td className="key">{t.key}</td>
                <td className="title-cell">{t.title}{t.blocked_by.length > 0 && <span className="chip warn small">⛔</span>}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select className="inline" value={t.state_id} style={{ borderColor: st.color }} onChange={(e) => patch(t, { state_id: +e.target.value })}>
                    {s.project.states.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </td>
                <td><span style={{ color: PRIORITY[t.priority].color }}>{PRIORITY[t.priority].icon}</span> {PRIORITY[t.priority].label}</td>
                <td><span className="with-avatar"><Avatar user={s.userById(t.assignee_id)} size={20} />{s.userById(t.assignee_id)?.name ?? <span className="muted">—</span>}</span></td>
                <td>{t.estimate ?? <span className="muted">—</span>}</td>
                <td className={late ? "overdue" : ""}>{fmtDate(t.due_date)}</td>
                <td>{t.labels.map((l) => <span key={l.id} className="chip" style={{ "--c": l.color } as React.CSSProperties}>{l.name}</span>)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <div className="empty big">No tasks match the current filters.</div>}
    </div>
  );
}
