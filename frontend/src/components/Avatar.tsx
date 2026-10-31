import type { User } from "../types";
import { initials } from "../util";

/** Initials on neutral glass: people are told apart by name, never by colour. */
export function Avatar({ user, size = 22 }: { user?: User | null; size?: number }) {
  if (!user) return <span className="avatar unassigned" style={{ width: size, height: size, fontSize: size * 0.44 }} title="Unassigned" aria-label="Unassigned">?</span>;
  return (
    <span className="avatar" title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: "var(--sunken)", color: "var(--ink-soft)", boxShadow: "inset 0 0 0 .5px var(--line-strong)" }}>
      {initials(user.name)}
    </span>
  );
}
