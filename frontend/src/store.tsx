import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { useProjectSocket, type RealtimeEvent } from "./realtime";
import type { Dependency, Member, Project, Sprint, Task, User } from "./types";

interface Filters { q: string; assignee: string; priority: string; label: string; sprint: string }

interface Ctx {
  me: User;
  members: Member[];
  project: Project;
  tasks: Task[];
  sprints: Sprint[];
  deps: Dependency[];
  live: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  visible: Task[];
  openTask: (id: number | null) => void;
  openId: number | null;
  reload: () => Promise<void>;
  reloadProject: () => Promise<void>;
  upsert: (t: Task) => void;
  remove: (id: number) => void;
  userById: (id: number | null) => User | undefined;
  toast: (msg: string) => void;
  version: number; // bumps on any realtime change so analytics views refetch
}

const C = createContext<Ctx | null>(null);
export const useStore = () => {
  const c = useContext(C);
  if (!c) throw new Error("useStore outside provider");
  return c;
};

export const EMPTY_FILTERS: Filters = { q: "", assignee: "", priority: "", label: "", sprint: "" };

export function ProjectProvider(props: { me: User; members: Member[]; projectId: number; toast: (m: string) => void; children: ReactNode; onProject: (p: Project) => void }) {
  const { projectId, me } = props;
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [live, setLive] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openId, openTask] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const reloadProject = useCallback(async () => {
    const p = await api<Project>(`/api/projects/${projectId}`);
    setProject(p); props.onProject(p);
  }, [projectId]);

  const reload = useCallback(async () => {
    const [t, s, d] = await Promise.all([
      api<Task[]>(`/api/projects/${projectId}/tasks`),
      api<Sprint[]>(`/api/projects/${projectId}/sprints`),
      api<Dependency[]>(`/api/projects/${projectId}/dependencies`),
    ]);
    setTasks(t); setSprints(s); setDeps(d); setVersion((v) => v + 1);
  }, [projectId]);

  useEffect(() => { setProject(null); setFilters(EMPTY_FILTERS); openTask(null); reloadProject(); reload(); }, [projectId]);

  const upsert = useCallback((t: Task) => {
    setTasks((all) => (all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [...all, t]));
    setVersion((v) => v + 1);
  }, []);
  const remove = useCallback((id: number) => { setTasks((all) => all.filter((x) => x.id !== id)); setVersion((v) => v + 1); }, []);

  const onEvent = useCallback((e: RealtimeEvent) => {
    if (e.event.startsWith("task.") && e.event !== "task.deleted") upsert(e.data as Task);
    else if (e.event === "task.deleted") remove(e.data.id);
    else if (e.event === "project.updated") reloadProject();
    else reload();
    if (e.actor_id && e.actor_id !== me.id) {
      const who = props.members.find((m) => m.user.id === e.actor_id)?.user.name ?? "Someone";
      const what = e.event === "task.created" ? `created ${e.data.key}` : e.event === "task.moved" ? `moved ${e.data.key}` : e.event === "task.updated" ? `updated ${e.data.key}` : e.event.replace(".", " ");
      props.toast(`${who} ${what}`);
    }
  }, [upsert, remove, reload, reloadProject, me.id, props.members]);
  useProjectSocket(projectId, onEvent, setLive);

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) =>
      (!q || t.title.toLowerCase().includes(q) || t.key.toLowerCase() === q) &&
      (!filters.assignee || String(t.assignee_id ?? "none") === filters.assignee) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.label || t.labels.some((l) => String(l.id) === filters.label)) &&
      (!filters.sprint || String(t.sprint_id ?? "none") === filters.sprint));
  }, [tasks, filters]);

  const userById = useCallback((id: number | null) => props.members.find((m) => m.user.id === id)?.user, [props.members]);

  if (!project) return <div className="loading">Loading project…</div>;
  return (
    <C.Provider value={{ me, members: props.members, project, tasks, sprints, deps, live, filters, setFilters, visible, openTask, openId, reload, reloadProject, upsert, remove, userById, toast: props.toast, version }}>
      {props.children}
    </C.Provider>
  );
}
