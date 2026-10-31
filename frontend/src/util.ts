import type { Priority } from "./types";

export const PRIORITY: Record<Priority, { label: string; rank: number }> = {
  urgent: { label: "Urgent", rank: 0 },
  high: { label: "High", rank: 1 },
  medium: { label: "Medium", rank: 2 },
  low: { label: "Low", rank: 3 },
  none: { label: "No priority", rank: 4 },
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

export const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = [...(words[0] ?? "?")][0] ?? "?";
  const last = words.length > 1 ? [...words[words.length - 1]][0] : "";
  return (first + last).toUpperCase();
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);

export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n);
  return iso(x);
};

/** Keyboard support for elements that cannot be a <button> (cards, table rows): Tab to focus, Enter/Space to activate. */
export const pressable = (fn: () => void) => ({
  role: "button" as const, tabIndex: 0, onClick: fn,
  onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); fn(); } },
});
