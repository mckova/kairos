import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { StateIcon } from "../components/Icons";
import { api } from "../api";
import { TaskCard } from "../components/TaskCard";
import { useStore } from "../store";
import type { Task } from "../types";

/** Kanban board with native HTML5 drag-and-drop, optimistic moves and WIP limits. */
export function Board({ onNew }: { onNew: (stateId: number) => void }) {
  const s = useStore();
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ state: number; index: number } | null>(null);
  const [critical, setCritical] = useState<Set<number>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);

  useEffect(() => {
    api<{ chain_ids: number[] }>(`/api/projects/${s.project.id}/analytics/critical-path`).then((r) => setCritical(new Set(r.chain_ids))).catch(() => {});
  }, [s.project.id, s.version]);

  const cancelled = s.project.states.find((st) => st.group === "cancelled");
  const columns = s.project.states.filter((st) => showCancelled || st.group !== "cancelled");
  const byState = (id: number) => s.visible.filter((t) => t.state_id === id).sort((a, b) => a.rank - b.rank);

  const onDragOver = (e: React.DragEvent, stateId: number) => {
    e.preventDefault();
    const col = e.currentTarget as HTMLElement;
    const cards = [...col.querySelectorAll<HTMLElement>("[data-task]")].filter((c) => +c.dataset.task! !== drag);
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; break; }
    }
    if (!drop || drop.state !== stateId || drop.index !== index) setDrop({ state: stateId, index });
  };

  const onDrop = async (stateId: number) => {
    if (drag == null || !drop) return;
    const list = byState(stateId).filter((t) => t.id !== drag);
    const before = list[drop.index - 1], after = list[drop.index];
    const task = s.tasks.find((t) => t.id === drag)!;
    setDrag(null); setDrop(null);
    // optimistic: place between neighbours locally, then reconcile with server response
    const optimistic: Task = { ...task, state_id: stateId, rank: before && after ? (before.rank + after.rank) / 2 : before ? before.rank + 1 : after ? after.rank - 1 : 0 };
    s.upsert(optimistic);
    try {
      s.upsert(await api<Task>(`/api/projects/${s.project.id}/tasks/${task.id}/move`, { method: "POST", json: { state_id: stateId, before_id: before?.id ?? null, after_id: after?.id ?? null } }));
    } catch (e) { s.upsert(task); s.toast((e as Error).message); }
  };

  return (
    <div className="board-wrap">
      <div className="board">
        {columns.map((st) => {
          const items = byState(st.id);
          const pts = items.reduce((a, t) => a + (t.estimate ?? 0), 0);
          const others = items.filter((t) => t.id !== drag);
          const over = st.wip_limit != null && items.length > st.wip_limit;
          return (
            <section key={st.id} className={`column${drop?.state === st.id ? " over" : ""}`}
              onDragOver={(e) => onDragOver(e, st.id)} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)} onDrop={() => onDrop(st.id)}>
              <header>
                <StateIcon group={st.group} name={st.name} />
                <b>{st.name}</b>
                <span className={`count${over ? " over" : ""}`} title={st.wip_limit ? `WIP limit ${st.wip_limit}` : ""}>{items.length}{st.wip_limit ? `/${st.wip_limit}` : ""}</span>
                <span className="spacer" />
                {pts > 0 && <span className="col-pts" title="Story points in this column">{pts} pt</span>}
                <button className="ghost icon col-add" title={`Add a task to ${st.name}`} aria-label={`Add a task to ${st.name}`} onClick={() => onNew(st.id)}><Plus className="i sm" /></button>
              </header>
              <div className="cards">
                {items.map((t) => (
                  <div key={t.id} className={drag === t.id ? "dragging" : ""}>
                    {drop?.state === st.id && drag !== t.id && drop.index === others.indexOf(t) && <div className="drop-line" />}
                    <TaskCard task={t} critical={critical.has(t.id) && !["completed", "cancelled"].includes(st.group)} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(t.id)); setDrag(t.id); }} />
                  </div>
                ))}
                {drop?.state === st.id && drop.index >= others.length && <div className="drop-line" />}
                {!items.length && <div className="empty">Nothing in {st.name.toLowerCase()}</div>}
              </div>
            </section>
          );
        })}
        {!showCancelled && cancelled && (
          <button className="ghost col-collapsed" onClick={() => setShowCancelled(true)} title="Show the cancelled column">
            Cancelled <span className="col-pts">{byState(cancelled.id).length}</span>
          </button>
        )}
        {showCancelled && <button className="ghost col-collapsed" onClick={() => setShowCancelled(false)} title="Hide the cancelled column">Hide cancelled</button>}
      </div>
    </div>
  );
}
