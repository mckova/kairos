import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PriorityIcon, StateIcon } from "./Icons";
import { api } from "../api";
import { useStore } from "../store";
import type { Activity, Comment, Task } from "../types";
import { PRIORITY, ago, fmtDate, pressable } from "../util";
import { Avatar } from "./Avatar";
import { Breakdown } from "./Breakdown";
import { Confirm } from "./Confirm";

const FIELD_LABEL: Record<string, string> = {
  state: "status", assignee_id: "assignee", sprint_id: "sprint", due_date: "due date", start_date: "start date",
  estimate: "estimate", priority: "priority", title: "title", description: "description", labels: "labels", blocked_by: "dependency",
};

export function TaskDrawer() {
  const s = useStore();
  const { openId, openTask, tasks, project, members, sprints, deps } = s;
  const task = tasks.find((t) => t.id === openId);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const base = `/api/projects/${project.id}`;

  const loadSide = async (id: number) => {
    const [c, a] = await Promise.all([api<Comment[]>(`${base}/tasks/${id}/comments`), api<Activity[]>(`${base}/tasks/${id}/activity`)]);
    setComments(c); setActivity(a);
  };
  useEffect(() => { if (task) { setTitle(task.title); setDesc(task.description); } }, [task?.id, task?.title, task?.description]);
  useEffect(() => { if (openId) loadSide(openId); }, [openId, task?.updated_at]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".modal-wrap")) openTask(null); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  if (!task) return null;

  const patch = async (body: Partial<Task> & { label_ids?: number[] }) => {
    try { s.upsert(await api<Task>(`${base}/tasks/${task.id}`, { method: "PATCH", json: body })); }
    catch (e) { s.toast((e as Error).message); }
  };
  const addDep = async (blocker: number) => {
    try { await api(`${base}/dependencies`, { method: "POST", json: { blocker_id: blocker, blocked_id: task.id } }); await s.reload(); }
    catch (e) { s.toast((e as Error).message); }
  };
  const rmDep = async (blocker: number) => {
    const d = deps.find((x) => x.blocker_id === blocker && x.blocked_id === task.id);
    if (d) { await api(`${base}/dependencies/${d.id}`, { method: "DELETE" }); await s.reload(); }
  };
  const send = async () => {
    if (!draft.trim()) return;
    await api(`${base}/tasks/${task.id}/comments`, { method: "POST", json: { body: draft } });
    setDraft(""); loadSide(task.id);
  };
  const del = async () => {
    setConfirmDel(false);
    await api(`${base}/tasks/${task.id}`, { method: "DELETE" });
    s.remove(task.id); openTask(null);
  };
  const byId = (id: number) => tasks.find((t) => t.id === id);
  const candidates = tasks.filter((t) => t.id !== task.id && !task.blocked_by.includes(t.id));

  return (
    <>
      <div className="scrim" onClick={() => openTask(null)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${task.key} ${task.title}`}>
        <header className="drawer-head">
          <span className="key">{task.key}</span>
          <span className="spacer" />
          <button className="ghost danger" onClick={() => setConfirmDel(true)}><Trash2 className="i sm" aria-hidden />Delete</button>
          <button className="ghost icon" onClick={() => openTask(null)} aria-label="Close"><X className="i" /></button>
        </header>
        <input className="title-input" aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && patch({ title })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />

        <div className="props">
          <label htmlFor="f-status">Status</label>
          <span className="with-avatar"><StateIcon group={project.states.find((x) => x.id === task.state_id)?.group ?? "unstarted"} name={project.states.find((x) => x.id === task.state_id)?.name} />
          <select id="f-status" value={task.state_id} onChange={(e) => patch({ state_id: +e.target.value })}>
            {project.states.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select></span>
          <label htmlFor="f-prio">Priority</label>
          <span className="with-avatar"><PriorityIcon priority={task.priority} />
          <select id="f-prio" value={task.priority} onChange={(e) => patch({ priority: e.target.value as Task["priority"] })}>
            {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></span>
          <label htmlFor="f-assignee">Assignee</label>
          <div className="with-avatar">
            <Avatar user={s.userById(task.assignee_id)} size={20} />
            <select id="f-assignee" value={task.assignee_id ?? ""} onChange={(e) => patch({ assignee_id: e.target.value ? +e.target.value : null })}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
            </select>
          </div>
          <label htmlFor="f-sprint">Sprint</label>
          <select id="f-sprint" value={task.sprint_id ?? ""} onChange={(e) => patch({ sprint_id: e.target.value ? +e.target.value : null })}>
            <option value="">No sprint</option>
            {sprints.filter((sp) => sp.status !== "closed" || sp.id === task.sprint_id).map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
          <label htmlFor="f-est">Estimate</label>
          <select id="f-est" value={task.estimate ?? ""} onChange={(e) => patch({ estimate: e.target.value === "" ? null : +e.target.value })}>
            <option value="">Not estimated</option>
            {[0.5, 1, 2, 3, 5, 8, 13].map((n) => <option key={n} value={n}>{n} {n === 1 ? "point" : "points"}</option>)}
          </select>
          <label htmlFor="f-start">Start</label>
          <input id="f-start" type="date" value={task.start_date ?? ""} onChange={(e) => patch({ start_date: e.target.value || null })} />
          <label htmlFor="f-due">Due</label>
          <input id="f-due" type="date" value={task.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
          <label>Labels</label>
          <div className="label-pick">
            {project.labels.map((l) => {
              const on = task.labels.some((x) => x.id === l.id);
              const ids = on ? task.labels.filter((x) => x.id !== l.id).map((x) => x.id) : [...task.labels.map((x) => x.id), l.id];
              return <button key={l.id} className={`chip toggle${on ? " on" : ""}`} aria-pressed={on} style={{ "--c": l.color } as React.CSSProperties} onClick={() => patch({ label_ids: ids })}><i />{l.name}</button>;
            })}
          </div>
        </div>

        <h4>Description</h4>
        <textarea className="desc" aria-label="Description" value={desc} rows={5} placeholder="Context, acceptance criteria, links. Mention a teammate with @name."
          onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== task.description && patch({ description: desc })} />

        <h4>Subtasks</h4>
        {tasks.filter((t) => t.parent_id === task.id).map((t) => <div key={t.id} className="dep-row link" {...pressable(() => openTask(t.id))}><span className="key">{t.key}</span> {t.title}<span className="spacer" /><span className="pts">{t.estimate != null ? `${t.estimate} pt` : ""}</span></div>)}
        <Breakdown key={task.id} task={task} />

        <h4>Dependencies</h4>
        <div className="deps">
          <div><small>Waits on</small>
            {task.blocked_by.map((id) => <div key={id} className="dep-row"><span className="key">{byId(id)?.key}</span><span className="t">{byId(id)?.title}</span><button className="ghost" onClick={() => rmDep(id)} aria-label={`Remove dependency on ${byId(id)?.key}`}><X className="i sm" /></button></div>)}
            <select value="" onChange={(e) => e.target.value && addDep(+e.target.value)}>
              <option value="">Add a task this one waits on</option>
              {candidates.map((t) => <option key={t.id} value={t.id}>{t.key} {t.title}</option>)}
            </select>
          </div>
          {task.blocks.length > 0 && <div><small>Holds up</small>
            {task.blocks.map((id) => <div key={id} className="dep-row"><span className="key">{byId(id)?.key}</span><span className="t">{byId(id)?.title}</span></div>)}
          </div>}
        </div>

        <div className="tabs small">
          <button className={tab === "comments" ? "on" : ""} onClick={() => setTab("comments")}>Comments ({comments.length})</button>
          <button className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>Activity ({activity.length})</button>
        </div>
        {tab === "comments" ? (
          <div className="comments">
            {comments.map((c) => (
              <div key={c.id} className="comment"><Avatar user={c.author} size={26} />
                <div><b>{c.author.name}</b> <small>{ago(c.created_at)}</small><p>{c.body}</p></div></div>
            ))}
            <div className="composer">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Comment, or @mention someone. Ctrl+Enter sends." aria-label="New comment"
                onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && send()} />
              <button className="primary" onClick={send} disabled={!draft.trim()}>Comment</button>
            </div>
          </div>
        ) : (
          <ul className="activity">
            {activity.slice().reverse().map((a) => (
              <li key={a.id}><Avatar user={a.actor} size={18} />
                <span><b>{a.actor?.name ?? "System"}</b>{" "}
                  {a.verb === "created" ? "created the task" : a.verb === "commented" ? "commented" :
                    <>changed {FIELD_LABEL[a.field ?? ""] ?? a.field}{a.new_value != null && <> to <em>{fieldValue(a.field, a.new_value, s)}</em></>}</>}
                  {" "}<small>{ago(a.created_at)}</small></span></li>
            ))}
          </ul>
        )}
        <footer className="drawer-foot"><small>Created {fmtDate(task.created_at, { day: "numeric", month: "short", year: "numeric" })}{task.completed_at && `. Completed ${fmtDate(task.completed_at)}.`}</small></footer>
      </aside>
      {confirmDel && <Confirm title={`Delete ${task.key}?`} body={`“${task.title}”, its comments and its history will be removed for everyone. This cannot be undone.`} action="Delete task" onConfirm={del} onCancel={() => setConfirmDel(false)} />}
    </>
  );
}

function fieldValue(field: string | null, v: string, s: ReturnType<typeof useStore>) {
  if (field === "assignee_id") return s.userById(+v)?.name ?? v;
  if (field === "sprint_id") return s.sprints.find((x) => x.id === +v)?.name ?? v;
  if (field === "labels") return v.split(",").map((id) => s.project.labels.find((l) => l.id === +id)?.name ?? id).join(", ") || "none";
  if (field === "description") return "…";
  return v;
}
