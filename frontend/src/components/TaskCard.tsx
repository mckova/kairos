import { CalendarDays, Lock, Route } from "lucide-react";
import { useStore } from "../store";
import type { Task } from "../types";
import { fmtDate, pressable, today } from "../util";
import { Avatar } from "./Avatar";
import { PriorityIcon } from "./Icons";

export function TaskCard({ task, onDragStart, critical }: { task: Task; onDragStart?: (e: React.DragEvent) => void; critical?: boolean }) {
  const { openTask, userById, tasks, project } = useStore();
  const openBlockers = task.blocked_by.filter((id) => {
    const b = tasks.find((t) => t.id === id);
    const g = project.states.find((s) => s.id === b?.state_id)?.group;
    return b && g !== "completed" && g !== "cancelled";
  });
  const done = project.states.find((s) => s.id === task.state_id)?.group === "completed";
  const overdue = !done && task.due_date && task.due_date < today();
  const blockerKeys = openBlockers.map((id) => tasks.find((t) => t.id === id)?.key).join(", ");
  return (
    <div className="card" draggable={!!onDragStart} onDragStart={onDragStart} {...pressable(() => openTask(task.id))} aria-label={`${task.key} ${task.title}`} data-task={task.id}>
      <div className="card-top">
        <span className="key">{task.key}</span>
        <span className="spacer" />
        {critical && <span className="flag risk" title="On the critical path: any slip here moves the finish date"><Route className="i sm" aria-hidden />Critical</span>}
        <PriorityIcon priority={task.priority} />
      </div>
      <div className="card-title">{task.title}</div>
      <div className="card-meta">
        {openBlockers.length > 0 && <span className="flag risk" title={`Waiting on ${blockerKeys}`}><Lock className="i sm" aria-hidden />Blocked by {blockerKeys}</span>}
        {task.labels.map((l) => <span key={l.id} className="tag" style={{ "--c": l.color } as React.CSSProperties}><i />{l.name}</span>)}
      </div>
      <div className="card-foot">
        {task.due_date && <span className={`due${overdue ? " overdue" : ""}`} title={overdue ? "Overdue" : "Due date"}><CalendarDays className="i sm" aria-hidden />{fmtDate(task.due_date)}</span>}
        <span className="spacer" />
        {task.estimate != null && <span className="pts" title="Story points">{task.estimate} pt</span>}
        <Avatar user={userById(task.assignee_id)} size={20} />
      </div>
    </div>
  );
}
