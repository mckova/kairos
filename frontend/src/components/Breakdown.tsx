import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Task } from "../types";

interface Sub { title: string; description: string; estimate: number; priority: Task["priority"]; depends_on: number[]; keep: boolean }

/** "Break down with AI": Claude proposes subtasks with estimates and dependencies; the user edits, then applies. */
export function Breakdown({ task }: { task: Task }) {
  const s = useStore();
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${s.project.id}/ai/breakdown`;
  const propose = async () => {
    setBusy(true);
    try {
      const r = await api<{ rationale: string; subtasks: Omit<Sub, "keep">[] }>(base, { method: "POST", json: { task_id: task.id } });
      setSubs(r.subtasks.map((x) => ({ ...x, keep: true }))); setWhy(r.rationale);
    } catch (e) { s.toast((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!subs) return;
    const kept = subs.map((x, i) => ({ ...x, i })).filter((x) => x.keep);
    const remap = new Map(kept.map((x, j) => [x.i, j]));
    const payload = kept.map(({ keep: _k, i: _i, ...x }) => ({ ...x, depends_on: x.depends_on.filter((d) => remap.has(d)).map((d) => remap.get(d)!) }));
    setBusy(true);
    try {
      const made = await api<Task[]>(`${base}/apply`, { method: "POST", json: { task_id: task.id, subtasks: payload } });
      await s.reload(); setSubs(null); s.toast(`Created ${made.map((t) => t.key).join(", ")}`);
    } catch (e) { s.toast((e as Error).message); } finally { setBusy(false); }
  };
  if (!subs) return <button className="ai-btn" onClick={propose} disabled={busy}>{busy ? "Thinking…" : "✦ Break down with AI"}</button>;
  const pts = subs.filter((x) => x.keep).reduce((a, x) => a + x.estimate, 0);
  return (
    <div className="breakdown">
      <p className="muted">{why}</p>
      {subs.map((x, i) => (
        <label key={i} className={`sub${x.keep ? "" : " off"}`}>
          <input type="checkbox" checked={x.keep} onChange={(e) => setSubs(subs.map((y, j) => (j === i ? { ...y, keep: e.target.checked } : y)))} />
          <input className="sub-title" value={x.title} onChange={(e) => setSubs(subs.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
          <span className="pts">{x.estimate}</span>
          {x.depends_on.length > 0 && <small className="muted">after #{x.depends_on.map((d) => d + 1).join(", #")}</small>}
        </label>
      ))}
      <div className="modal-actions"><small className="muted">{pts} pts total</small><span className="spacer" /><button className="ghost" onClick={() => setSubs(null)}>Discard</button><button className="primary" onClick={apply} disabled={busy}>Create subtasks</button></div>
    </div>
  );
}
