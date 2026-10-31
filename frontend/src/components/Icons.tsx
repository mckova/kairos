/** Product glyphs drawn for Kairos: the mark, status and priority. General icons come from lucide. */
import type { Priority, StateGroup } from "../types";

export function Mark({ className = "mark" }: { className?: string }) {
  // A dial with one hand caught at the moment: the "right time" the name refers to.
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 10V4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 10l4.2 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

const STATE_COLOR: Record<StateGroup, string> = {
  backlog: "var(--ink-faint)", unstarted: "var(--ink-soft)", started: "var(--caution)", completed: "var(--done)", cancelled: "var(--ink-faint)",
};

/** One shape per state group, so status reads without relying on colour alone. */
export function StateIcon({ group, size = 14, title }: { group: StateGroup; size?: number; title?: string }) {
  const c = STATE_COLOR[group];
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} className="state-ico" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {group === "backlog" && <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="2.2 1.8" />}
      {group === "unstarted" && <circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.4" />}
      {group === "started" && <><circle cx="7" cy="7" r="5.5" fill="none" stroke={c} strokeWidth="1.4" /><path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill={c} /></>}
      {group === "completed" && <><circle cx="7" cy="7" r="6.2" fill={c} /><path d="M4.4 7.2l1.8 1.8 3.5-3.7" fill="none" style={{ stroke: "var(--on-solid)" }} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>}
      {group === "cancelled" && <><circle cx="7" cy="7" r="6.2" fill={c} /><path d="M5 5l4 4M9 5l-4 4" style={{ stroke: "var(--on-solid)" }} strokeWidth="1.4" strokeLinecap="round" /></>}
    </svg>
  );
}

/** Three ascending bars, filled by level; urgent is a solid square with a mark. */
export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const label = priority === "none" ? "No priority" : `${priority[0].toUpperCase()}${priority.slice(1)} priority`;
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" width={size} height={size} className="prio-ico urgent" role="img" aria-label={label}>
        <rect x="1" y="1" width="12" height="12" rx="2.5" fill="currentColor" />
        <path d="M7 3.8v4" style={{ stroke: "var(--on-solid)" }} strokeWidth="1.6" strokeLinecap="round" /><circle cx="7" cy="10.1" r="0.95" style={{ fill: "var(--on-solid)" }} />
      </svg>
    );
  }
  const filled = { none: 0, low: 1, medium: 2, high: 3 }[priority];
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} className="prio-ico" role="img" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4.2} y={9 - i * 3} width="2.8" height={4 + i * 3} rx="0.8"
          fill="currentColor" opacity={priority === "none" ? 0.22 : i < filled ? 1 : 0.22} />
      ))}
    </svg>
  );
}
