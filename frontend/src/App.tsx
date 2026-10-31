import { useCallback, useEffect, useState } from "react";
import { CalendarRange, ChartNoAxesColumn, GanttChart, Inbox, KanbanSquare, LayoutList, LogOut, Moon, MessageSquareText, Plus, Rows3, Search, SunMoon } from "lucide-react";
import { api, auth, qs } from "./api";
import { Avatar } from "./components/Avatar";
import { CommandPalette } from "./components/CommandPalette";
import { Copilot } from "./components/Copilot";
import { Filters } from "./components/Filters";
import { Mark } from "./components/Icons";
import { NewTask } from "./components/NewTask";
import { TaskDrawer } from "./components/TaskDrawer";
import { useUserSocket } from "./realtime";
import { ProjectProvider, useStore } from "./store";
import type { Member, Notification, Project, User, Workspace } from "./types";
import { Board } from "./views/Board";
import { Insights } from "./views/Insights";
import { ListView } from "./views/ListView";
import { MyDay } from "./views/MyDay";
import { SprintView } from "./views/SprintView";
import { Timeline } from "./views/Timeline";

type View = "board" | "list" | "timeline" | "sprint" | "insights";
const VIEWS: { id: View; label: string; Icon: typeof Rows3 }[] = [
  { id: "list", label: "List", Icon: Rows3 },
  { id: "board", label: "Board", Icon: KanbanSquare },
  { id: "timeline", label: "Timeline", Icon: GanttChart },
  { id: "sprint", label: "Sprints", Icon: CalendarRange },
  { id: "insights", label: "Insights", Icon: ChartNoAxesColumn },
];

interface Route { me: boolean; pid: number | null; view: View; task: number | null }
function parseHash(): Route {
  if (location.hash.startsWith("#/me")) return { me: true, pid: null, view: "list", task: null };
  const m = location.hash.match(/^#\/p\/(\d+)\/(\w+)(?:\/t\/(\d+))?/);
  return { me: false, pid: m ? +m[1] : null, view: (VIEWS.find((v) => v.id === m?.[2])?.id ?? "list") as View, task: m?.[3] ? +m[3] : null };
}

export default function App() {
  const [me, setMe] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!auth.token) { setChecked(true); return; }
    api<User>("/api/auth/me").then(setMe).catch(() => auth.clear()).finally(() => setChecked(true));
  }, []);
  if (!checked) return <div className="loading">Loading…</div>;
  return me ? <Shell me={me} /> : <Login onAuth={setMe} />;
}

function Login({ onAuth }: { onAuth: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", password: "", name: "" });
  const [err, setErr] = useState("");
  const go = async (body: typeof f, m = mode) => {
    setErr("");
    try {
      const r = await api<{ access_token: string; user: User }>(`/api/auth/${m}`, { method: "POST", json: m === "login" ? { email: body.email, password: body.password } : body });
      auth.set(r.access_token); onAuth(r.user);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="login">
      <div className="login-art">
        <div className="brand"><Mark /> Kairos</div>
        <div className="login-copy">
          <h1>Know when the work will land.</h1>
          <p>Plan sprints, see the critical path, and get a delivery date your team can trust.</p>
          <ForecastFigure />
        </div>
        <p className="login-foot">Delivery dates are simulated from the work your team actually finished.</p>
      </div>
      <form className="login-card" onSubmit={(e) => { e.preventDefault(); go(f); }}>
        <h2>{mode === "login" ? "Sign in" : "Create an account"}</h2>
        {mode === "register" && <input placeholder="Full name" aria-label="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}
        <input type="email" placeholder="Work email" aria-label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input type="password" placeholder="Password" aria-label="Password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {err && <div className="error" role="alert">{err}</div>}
        <button className="primary">{mode === "login" ? "Sign in" : "Create account"}</button>
        <div className="or">or</div>
        <button type="button" className="demo" onClick={() => go({ email: "demo@kairos.dev", password: "demo1234", name: "" }, "login")}>Open the demo workspace</button>
        <p className="muted">{mode === "login" ? "New here? " : "Have an account? "}
          <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); }}>{mode === "login" ? "Create an account" : "Sign in"}</a></p>
      </form>
    </div>
  );
}

function Shell({ me }: { me: User }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [ws, setWs] = useState<Workspace | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [route, setRoute] = useState(parseHash());
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [modal, setModal] = useState<"project" | "workspace" | null>(null);
  const [inbox, setInbox] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const [palette, setPalette] = useState(false);
  const [ask, setAsk] = useState<{ text: string; n: number } | null>(null);
  const [newSignal, setNewSignal] = useState(0);

  const toast = useCallback((msg: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  useEffect(() => { const h = () => setRoute(parseHash()); window.addEventListener("hashchange", h); return () => window.removeEventListener("hashchange", h); }, []);
  const loadWs = async () => {
    const list = await api<Workspace[]>("/api/workspaces");
    setWorkspaces(list);
    setWs((cur) => list.find((w) => w.id === cur?.id) ?? list[0] ?? null);
  };
  useEffect(() => { loadWs(); }, []);
  const loadInbox = useCallback(() => api<{ unread: number; items: Notification[] }>("/api/me/notifications").then(setInbox).catch(() => {}), []);
  useEffect(() => { loadInbox(); }, []);
  useUserSocket((e) => { if (e.event === "notification.created") { loadInbox(); toast(e.data.text); } });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setPalette((v) => !v); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  useEffect(() => {
    if (!ws) return;
    Promise.all([api<Project[]>(`/api/workspaces/${ws.id}/projects`), api<Member[]>(`/api/workspaces/${ws.id}/members`)]).then(([p, m]) => {
      setProjects(p); setMembers(m);
      const r = parseHash();
      if (!r.me && (!r.pid || !p.some((x) => x.id === r.pid))) { if (p[0]) location.hash = `#/p/${p[0].id}/${r.view}`; }
    });
  }, [ws?.id]);

  const go = (pid: number, view: View = route.view) => { location.hash = `#/p/${pid}/${view}`; };
  const goTask = (pid: number, tid: number) => { location.hash = `#/p/${pid}/${route.me ? "list" : route.view}/t/${tid}`; };
  const askAI = (text: string) => {
    if (!pid && projects[0]) go(projects[0].id);
    setAsk({ text, n: Date.now() });
  };
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "light");
  const flipTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; localStorage.setItem("kairos.theme", next); setTheme(next);
  };
  const logout = () => { auth.clear(); location.hash = ""; location.reload(); };
  const pid = !route.me && route.pid && projects.some((p) => p.id === route.pid) ? route.pid : null;

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <a className="rail-mark" href={projects[0] ? `#/p/${pid ?? projects[0].id}/${route.view}` : "#"} aria-label="Kairos home"><Mark /></a>
        <button className="rail-btn" onClick={() => setPalette(true)} title="Find or ask (Ctrl K)" aria-label="Find or ask"><Search className="i" /></button>
        <a href="#/me" className={`rail-btn${route.me ? " on" : ""}`} aria-current={route.me ? "page" : undefined} title="My day and inbox" aria-label={`My day${inbox.unread ? `, ${inbox.unread} unread` : ""}`}>
          <Inbox className="i" />{inbox.unread > 0 && <span className="rail-dot" />}
        </a>
        <a href={pid || projects[0] ? `#/p/${pid ?? projects[0].id}/list` : "#"} className={`rail-btn${pid ? " on" : ""}`} aria-current={pid ? "page" : undefined} title="Projects" aria-label="Projects"><LayoutList className="i" /></a>
        <span className="spacer" />
        <button className="rail-btn" onClick={flipTheme} title={theme === "dark" ? "Light mode" : "Dark mode"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>{theme === "dark" ? <SunMoon className="i" /> : <Moon className="i" />}</button>
        <button className="rail-btn" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut className="i" /></button>
        <span className="rail-me" title={`${me.name} (${me.email})`}><Avatar user={me} size={30} /></span>
      </nav>
      <main className="main">
        {route.me ? (
          <MyDay me={me} inbox={inbox} onInbox={loadInbox} openTask={goTask} />
        ) : pid ? (
          <ProjectProvider key={pid} me={me} members={members} projectId={pid} toast={toast} onProject={(p) => setProjects((all) => all.map((x) => (x.id === p.id ? p : x)))}>
            <ProjectPage view={route.view} setView={(v) => go(pid, v)} task={route.task} ask={ask} newSignal={newSignal}
              switcher={<ProjectSwitch projects={projects} current={pid} go={(id) => go(id)} workspaces={workspaces} ws={ws} setWs={setWs} onNew={() => setModal(ws ? "project" : "workspace")} />} />
          </ProjectProvider>
        ) : (
          <div className="empty big">{projects.length ? "Pick a project" : <>No projects yet. <button className="primary" onClick={() => setModal(ws ? "project" : "workspace")}>{ws ? "Create a project" : "Create a workspace"}</button></>}</div>
        )}
      </main>
      {modal === "project" && ws && <NewProject ws={ws} onClose={() => setModal(null)} onCreated={(p) => { setProjects((x) => [...x, p]); go(p.id, "board"); setModal(null); }} />}
      {modal === "workspace" && <NewWorkspace onClose={() => setModal(null)} onCreated={async () => { setModal(null); await loadWs(); }} />}
      {palette && (
        <CommandPalette projects={projects} currentProject={pid} goProject={(p, v) => go(p, (v as View) ?? "board")} goMyDay={() => { location.hash = "#/me"; }}
          openTask={goTask} newTask={() => setNewSignal(Date.now())} askAI={askAI} onClose={() => setPalette(false)} />
      )}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}</div>
    </div>
  );
}

function ProjectPage({ view, setView, task, ask, newSignal, switcher }: {
  view: View; setView: (v: View) => void; task: number | null; ask: { text: string; n: number } | null; newSignal: number; switcher: React.ReactNode;
}) {
  const s = useStore();
  const [newIn, setNewIn] = useState<number | undefined | null>(null);
  const [copilot, setCopilot] = useState(false);
  const [initial, setInitial] = useState<string | undefined>();
  const loaded = s.tasks.length > 0;
  useEffect(() => { if (task && loaded) { s.openTask(task); history.replaceState(null, "", `#/p/${s.project.id}/${view}`); } }, [task, loaded]);
  useEffect(() => { if (ask) { setInitial(ask.text); setCopilot(true); } }, [ask?.n]);
  useEffect(() => { if (newSignal) setNewIn(undefined); }, [newSignal]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) { e.preventDefault(); setInitial(undefined); setCopilot((v) => !v); }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) { e.preventDefault(); setNewIn(undefined); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <>
      <section className="sheet project-sheet">
        <div className="toolbar">
          {switcher}
          <span className="spacer" />
          <button className="ghost" onClick={() => setCopilot(!copilot)} title="Ask about this project or tell it what to change (A)" aria-expanded={copilot}><MessageSquareText className="i" aria-hidden />Ask</button>
          <button className="primary" onClick={() => setNewIn(undefined)} title="New task (C)"><Plus className="i" aria-hidden />New task</button>
        </div>
        <CycleHeadline />
        <div className="viewbar">
          <div className="segmented" role="tablist" aria-label="Views">
            {VIEWS.map((v) => <button key={v.id} role="tab" aria-selected={view === v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)}>{v.label}</button>)}
          </div>
          {["board", "list", "timeline"].includes(view) && <Filters />}
        </div>
        <div className="view">
          {view === "board" && <Board onNew={(sid) => setNewIn(sid)} />}
          {view === "list" && <ListView />}
          {view === "timeline" && <Timeline />}
          {view === "sprint" && <SprintView />}
          {view === "insights" && <Insights />}
        </div>
      </section>
      {newIn !== null && <NewTask stateId={newIn} onClose={() => setNewIn(null)} />}
      <TaskDrawer />
      {copilot && <Copilot initial={initial} onClose={() => { setCopilot(false); setInitial(undefined); }} />}
    </>
  );
}

/** Projects as a segmented control, plus workspace choice when there is more than one. */
function ProjectSwitch({ projects, current, go, workspaces, ws, setWs, onNew }: {
  projects: Project[]; current: number; go: (id: number) => void; workspaces: Workspace[]; ws: Workspace | null; setWs: (w: Workspace | null) => void; onNew: () => void;
}) {
  return (
    <div className="switch">
      {workspaces.length > 1 && (
        <select className="menu-select" aria-label="Workspace" value={ws?.id ?? ""} onChange={(e) => setWs(workspaces.find((w) => w.id === +e.target.value) ?? null)}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      <select className="title-select" aria-label="Project" value={current} onChange={(e) => go(+e.target.value)}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="ghost icon" onClick={onNew} title="New project" aria-label="New project"><Plus className="i sm" /></button>
    </div>
  );
}

interface CycleForecast { remaining_points: number; probability_on_time: number | null; p50: string | null; deadline: string | null }

/** The page opens with the answer to "will this cycle land on time?", stated in one sentence. */
function CycleHeadline() {
  const s = useStore();
  const sprint = s.sprints.find((x) => x.status === "active");
  const [fc, setFc] = useState<CycleForecast | null>(null);
  useEffect(() => {
    if (!sprint) { setFc(null); return; }
    api<CycleForecast>(`/api/projects/${s.project.id}/analytics/forecast${qs({ sprint_id: sprint.id })}`).then(setFc).catch(() => setFc(null));
  }, [sprint?.id, s.version]);
  if (!sprint) return <div className="headline"><p className="kicker">{s.project.name}</p><h1>{s.project.description || "No active sprint."}</h1></div>;
  const groupOf = (stateId: number) => s.project.states.find((x) => x.id === stateId)?.group;
  const scope = s.tasks.filter((t) => t.sprint_id === sprint.id && groupOf(t.state_id) !== "cancelled");
  const total = scope.reduce((n, t) => n + (t.estimate ?? 0), 0);
  const done = scope.filter((t) => groupOf(t.state_id) === "completed").reduce((n, t) => n + (t.estimate ?? 0), 0);
  const start = new Date(sprint.start_date).getTime(), end = new Date(sprint.end_date).getTime();
  const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  const late = fc?.p50 ? Math.round((new Date(fc.p50).getTime() - end) / 864e5) : 0;
  const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="headline">
      <div className="headline-main">
      <p className="kicker">{sprint.name}</p>
      <div className="cycle-bar" role="img" aria-label={`${done} of ${total} points done, ${Math.round(elapsed * 100)}% of the sprint elapsed`}>
        <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /><b style={{ left: `${elapsed * 100}%` }} />
      </div>
      <h1>
        <em>{done} of {total} points</em> done.{" "}
        {fc?.p50 ? (late > 0
          ? <>At this pace the sprint ends <span className="late">{day(fc.p50)}, {late === 1 ? "a day" : `${late} days`} late</span>.</>
          : <>At this pace it lands by <em>{day(fc.p50)}</em>, on time.</>)
          : <>Ends {day(sprint.end_date)}.</>}
      </h1>
      </div>
      {fc && (
        <dl className="cycle-facts">
          {fc.p50 && <div><dt>Likely finish</dt><dd className={late > 0 ? "late" : ""}>{day(fc.p50)}</dd></div>}
          <div><dt>Sprint ends</dt><dd>{day(sprint.end_date)}</dd></div>
          {fc.probability_on_time != null && <div><dt>Chance on time</dt><dd>{Math.round(fc.probability_on_time * 100)}%</dd></div>}
        </dl>
      )}
    </div>
  );
}

/** A small, deliberate palette for project markers, tuned to sit on the bone canvas in both themes. */
const SWATCHES = ["#2c6a86", "#4f8a68", "#c97b3c", "#c8513f", "#6c6aa8", "#3f8a8a", "#7a8592"];

/** The login page's one figure: what a delivery forecast looks like, drawn the way the product draws it. */
function ForecastFigure() {
  const runs = [1, 3, 8, 16, 29, 44, 58, 66, 63, 54, 43, 31, 22, 14, 9, 5, 3, 1];
  const W = 432, H = 112, bw = W / runs.length, max = Math.max(...runs);
  const p50 = 8, p85 = 12;
  const mark = (i: number, label: string) => (
    <g className="ff-mark"><line x1={i * bw + bw / 2} x2={i * bw + bw / 2} y1={8} y2={H} /><text x={i * bw + bw / 2 + 5} y={16}>{label}</text></g>
  );
  return (
    <figure className="forecast-figure" aria-label="Example forecast: 50% likely by 25 November, 85% likely by 29 November">
      <figcaption><span>Pulse SaaS Launch</span><span>5,000 simulated finishes</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="presentation">
        {runs.map((r, i) => <rect key={i} x={i * bw + 1.5} y={H - (r / max) * (H - 28)} width={bw - 3} height={(r / max) * (H - 28)} className={i <= p50 ? "in" : i <= p85 ? "mid" : ""} />)}
        <line x1={0} x2={W} y1={H} y2={H} className="ff-base" />
        {mark(p50, "50%  25 Nov")}{mark(p85, "85%  29 Nov")}
        {([[0, "17 Nov"], [4, "21"], [8, "25"], [12, "29"], [16, "3 Dec"]] as const).map(([i, t]) => <text key={i} x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="ff-axis">{t}</text>)}
      </svg>
    </figure>
  );
}

function NewProject({ ws, onClose, onCreated }: { ws: Workspace; onClose: () => void; onCreated: (p: Project) => void }) {
  const [f, setF] = useState({ name: "", key: "", description: "", color: SWATCHES[0] });
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { onCreated(await api<Project>(`/api/workspaces/${ws.id}/projects`, { method: "POST", json: f })); }
    catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <form className="modal" onSubmit={submit}>
        <h3>New project</h3>
        <input autoFocus placeholder="Project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, key: f.key || "" })}
          onBlur={() => !f.key && setF({ ...f, key: f.name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() })} />
        <div className="grid2">
          <label>Key (e.g. WEB)<input value={f.key} maxLength={8} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></label>
          <fieldset className="swatches"><legend>Colour</legend>{SWATCHES.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} />)}</fieldset>
        </div>
        <textarea placeholder="What is this project about?" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!f.name || f.key.length < 2}>Create</button></div>
      </form>
    </div>
  );
}

function NewWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ws";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api("/api/workspaces", { method: "POST", json: { name, slug: `${slug}-${Math.floor(Math.random() * 1000)}` } }); onCreated(); }
    catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <form className="modal" onSubmit={submit}>
        <h3>New workspace</h3>
        <input autoFocus placeholder="Team or company name" value={name} onChange={(e) => setName(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!name}>Create</button></div>
      </form>
    </div>
  );
}
