import type { User } from "../types";
import { initials } from "../util";

export function Avatar({ user, size = 24 }: { user?: User | null; size?: number }) {
  if (!user) return <span className="avatar unassigned" style={{ width: size, height: size }} title="Unassigned">?</span>;
  return (
    <span className="avatar" title={user.name} style={{ width: size, height: size, background: user.avatar_color, fontSize: size * 0.42 }}>
      {initials(user.name)}
    </span>
  );
}
