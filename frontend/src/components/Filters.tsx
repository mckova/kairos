import { EMPTY_FILTERS, useStore } from "../store";
import { PRIORITY } from "../util";

export function Filters() {
  const { filters, setFilters, members, project, sprints, live } = useStore();
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const active = Object.values(filters).some(Boolean);
  return (
    <div className="filters">
      <input className="search" placeholder={`Search or ${project.key}-12…`} value={filters.q} onChange={set("q")} />
      <select value={filters.assignee} onChange={set("assignee")}>
        <option value="">All people</option>
        <option value="none">Unassigned</option>
        {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
      </select>
      <select value={filters.priority} onChange={set("priority")}>
        <option value="">Any priority</option>
        {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <select value={filters.label} onChange={set("label")}>
        <option value="">All labels</option>
        {project.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select value={filters.sprint} onChange={set("sprint")}>
        <option value="">All sprints</option>
        <option value="none">No sprint</option>
        {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {active && <button className="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>}
      <span className={`live${live ? " on" : ""}`} title={live ? "Real-time sync connected" : "Reconnecting…"}>{live ? "● Live" : "○ Offline"}</span>
    </div>
  );
}
