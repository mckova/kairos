import type { Priority } from "./types";

export const PRIORITY: Record<Priority, { label: string; color: string; icon: string; rank: number }> = {
  urgent: { label: "Urgent", color: "#ef4444", icon: "⏫", rank: 0 },
  high: { label: "High", color: "#f97316", icon: "🔼", rank: 1 },
  medium: { label: "Medium", color: "#eab308", icon: "⏺", rank: 2 },
  low: { label: "Low", color: "#3b82f6", icon: "🔽", rank: 3 },
  none: { label: "None", color: "#94a3b8", icon: "–", rank: 4 },
};

export const fmtDate = (s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("en-GB", opts) : "";

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
export const today = () => iso(new Date());

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso + (iso.endsWith("Z") ? "" : "Z")).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n);
  return iso(x);
};
