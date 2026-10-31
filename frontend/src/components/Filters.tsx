import { Search } from "lucide-react";
import { EMPTY_FILTERS, useStore } from "../store";
import { PRIORITY } from "../util";

export function Filters() {
  const { filters, setFilters, members, project, sprints, live } = useStore();
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const active = Object.values(filters).some(Boolean);
  return (
    <div className="filters">
      <label className="search-field"><Search className="i sm" aria-hidden /><input placeholder={`Filter by title or ${project.key}-12`} aria-label="Filter tasks" value={filters.q} onChange={set("q")} /></label>
      <select aria-label="Assignee" value={filters.assignee} onChange={set("assignee")}>
        <option value="">All people</option>
        <option value="none">Unassigned</option>
        {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
      </select>
      <select aria-label="Priority" value={filters.priority} onChange={set("priority")}>
        <option value="">Any priority</option>
        {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <select aria-label="Label" value={filters.label} onChange={set("label")}>
        <option value="">All labels</option>
        {project.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select aria-label="Sprint" value={filters.sprint} onChange={set("sprint")}>
        <option value="">All sprints</option>
        <option value="none">No sprint</option>
        {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {active && <button className="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
      <span className={`live${live ? " on" : ""}`} role="status" title={live ? "Changes from teammates appear as they happen" : "Reconnecting"}><i />{live ? "Synced" : "Reconnecting"}</span>
    </div>
  );
}
