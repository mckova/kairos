import { useStore } from "../store";
import type { Task } from "../types";
import { PRIORITY, fmtDate, today } from "../util";
import { Avatar } from "./Avatar";

export function TaskCard({ task, onDragStart, critical }: { task: Task; onDragStart?: (e: React.DragEvent) => void; critical?: boolean }) {
  const { openTask, userById, tasks, project } = useStore();
  const openBlockers = task.blocked_by.filter((id) => {
    const b = tasks.find((t) => t.id === id);
    const g = project.states.find((s) => s.id === b?.state_id)?.group;
    return b && g !== "completed" && g !== "cancelled";
  });
  const done = project.states.find((s) => s.id === task.state_id)?.group === "completed";
  const overdue = !done && task.due_date && task.due_date < today();
  return (
    <div className={`card${critical ? " critical" : ""}`} draggable={!!onDragStart} onDragStart={onDragStart} onClick={() => openTask(task.id)} data-task={task.id}>
      <div className="card-top">
        <span className="key">{task.key}</span>
        {task.priority !== "none" && <span className="prio" style={{ color: PRIORITY[task.priority].color }} title={PRIORITY[task.priority].label}>{PRIORITY[task.priority].icon}</span>}
      </div>
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        {task.labels.map((l) => <span key={l.id} className="chip" style={{ "--c": l.color } as React.CSSProperties}>{l.name}</span>)}
        {openBlockers.length > 0 && <span className="chip warn" title="Blocked by open tasks">⛔ blocked</span>}
        {critical && <span className="chip crit" title="On the critical path">critical</span>}
      </div>
      <div className="card-foot">
        <span className={`due${overdue ? " overdue" : ""}`}>{task.due_date ? `📅 ${fmtDate(task.due_date)}` : ""}</span>
        <span className="foot-right">
          {task.estimate != null && <span className="pts" title="Story points">{task.estimate}</span>}
          <Avatar user={userById(task.assignee_id)} size={22} />
        </span>
      </div>
    </div>
  );
}
