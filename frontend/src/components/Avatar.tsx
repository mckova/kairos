import type { User } from "../types";
import { initials } from "../util";

/** Initials on a quiet tint of the person's colour, so a row of avatars never turns into confetti. */
export function Avatar({ user, size = 22 }: { user?: User | null; size?: number }) {
  if (!user) return <span className="avatar unassigned" style={{ width: size, height: size, fontSize: size * 0.44 }} title="Unassigned" aria-label="Unassigned">?</span>;
  return (
    <span className="avatar" title={user.name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `color-mix(in srgb, ${user.avatar_color} 20%, var(--raised))`, color: `color-mix(in srgb, ${user.avatar_color} 62%, var(--ink))` }}>
      {initials(user.name)}
    </span>
  );
}
