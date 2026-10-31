import { useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import type { Task, Triage } from "../types";
import { PRIORITY } from "../util";

export function NewTask({ stateId, onClose }: { stateId?: number; onClose: () => void }) {
  const s = useStore();
  const active = s.sprints.find((x) => x.status === "active");
  const [f, setF] = useState({ title: "", state_id: stateId ?? "", priority: "none", assignee_id: "", estimate: "", sprint_id: active ? String(active.id) : "", due_date: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [labelIds, setLabelIds] = useState<number[]>([]);
  const [desc, setDesc] = useState("");
  const fill = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ title: string; description: string; priority: string; assignee_id: number | null; estimate: number | null; due_date: string | null; sprint_id: number | null; label_ids: number[] }>(
        `/api/projects/${s.project.id}/ai/parse-task`, { method: "POST", json: { text: note } });
      setF({ ...f, title: r.title, priority: r.priority, assignee_id: r.assignee_id ? String(r.assignee_id) : "", estimate: r.estimate ? String(r.estimate) : "",
        sprint_id: r.sprint_id ? String(r.sprint_id) : f.sprint_id, due_date: r.due_date ?? "" });
      setLabelIds(r.label_ids); setDesc(r.description);
    } catch (err) { s.toast((err as Error).message); } finally { setBusy(false); }
  };
  const [tri, setTri] = useState<Triage | null>(null);
  const [triBusy, setTriBusy] = useState(false);
  const triage = async () => {
    if (f.title.trim().length < 3) return;
    setTriBusy(true);
    try { setTri(await api<Triage>(`/api/projects/${s.project.id}/ai/triage`, { method: "POST", json: { title: f.title.trim(), description: desc } })); }
    catch (err) { s.toast((err as Error).message); } finally { setTriBusy(false); }
  };
  const applyTriage = () => {
    if (!tri) return;
    setF({ ...f, priority: tri.priority, estimate: tri.estimate != null ? String(tri.estimate) : f.estimate, assignee_id: tri.assignee_id ? String(tri.assignee_id) : f.assignee_id });
    if (tri.label_ids.length) setLabelIds(tri.label_ids);
    setTri(null);
  };
  const who = (id: number | null) => s.members.find((m) => m.user.id === id)?.user.name;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      const t = await api<Task>(`/api/projects/${s.project.id}/tasks`, {
        method: "POST",
        json: {
          title: f.title.trim(), priority: f.priority,
          state_id: f.state_id ? +f.state_id : null, assignee_id: f.assignee_id ? +f.assignee_id : null,
          estimate: f.estimate ? +f.estimate : null, sprint_id: f.sprint_id ? +f.sprint_id : null, due_date: f.due_date || null,
          label_ids: labelIds, description: desc,
        },
      });
      s.upsert(t); s.toast(`Created ${t.key}`); onClose();
    } catch (err) { s.toast((err as Error).message); setBusy(false); }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <form className="modal" onSubmit={submit}>
        <h3>New task in {s.project.name}</h3>
        <div className="ai-capture">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="✦ Describe it in your own words - e.g. “Dor should fix the flaky checkout test by Thursday, urgent, ~2 pts”" />
          <button type="button" className="ai-btn" onClick={fill} disabled={busy || !note.trim()}>{busy ? "Reading…" : "✦ Fill with AI"}</button>
        </div>
        <div className="title-row">
          <input autoFocus className="title-input" placeholder="What needs to be done?" value={f.title} onChange={set("title")} />
          <button type="button" className="ai-btn" onClick={triage} disabled={triBusy || f.title.trim().length < 3} title="Suggest priority, estimate, labels and owner; check for duplicates">{triBusy ? "Triaging…" : "✦ Triage"}</button>
        </div>
        {tri && (
          <div className="triage">
            {!!tri.duplicates.length && (
              <div className="dupes">⚠ Possible duplicate{tri.duplicates.length > 1 ? "s" : ""}:
                {tri.duplicates.map((d) => <button type="button" key={d.task_id} className="link-btn" onClick={() => { onClose(); s.openTask(d.task_id); }} title={d.reason}><span className="key">{d.key}</span> {d.title}</button>)}
              </div>
            )}
            <div className="tri-sugg">
              <span><b>{PRIORITY[tri.priority].icon} {PRIORITY[tri.priority].label}</b></span>
              <span><b>{tri.estimate ?? "?"} pts</b></span>
              {tri.assignee_id && <span title={tri.assignee_reason}>→ <b>{who(tri.assignee_id)}</b> <small className="muted">{tri.assignee_reason}</small></span>}
              {tri.label_ids.map((id) => <span key={id} className="chip">{s.project.labels.find((l) => l.id === id)?.name}</span>)}
            </div>
            <small className="muted">{tri.rationale}</small>
            <div className="tri-actions"><button type="button" className="ghost" onClick={() => setTri(null)}>Dismiss</button><button type="button" className="primary" onClick={applyTriage}>Apply suggestions</button></div>
          </div>
        )}
        <div className="grid2">
          <label>Status<select value={f.state_id} onChange={set("state_id")}><option value="">Default (To do)</option>{s.project.states.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}</select></label>
          <label>Priority<select value={f.priority} onChange={set("priority")}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label>Assignee<select value={f.assignee_id} onChange={set("assignee_id")}><option value="">Unassigned</option>{s.members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}</select></label>
          <label>Estimate<select value={f.estimate} onChange={set("estimate")}><option value="">–</option>{[0.5, 1, 2, 3, 5, 8, 13].map((n) => <option key={n} value={n}>{n} pts</option>)}</select></label>
          <label>Sprint<select value={f.sprint_id} onChange={set("sprint_id")}><option value="">No sprint</option>{s.sprints.filter((x) => x.status !== "closed").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label>Due date<input type="date" value={f.due_date} onChange={set("due_date")} /></label>
        </div>
        <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.title.trim()}>Create task</button></div>
      </form>
    </div>
  );
}
