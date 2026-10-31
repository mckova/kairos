import { ArrowDownUp, CornerDownLeft, FileText, Folder, LayoutList, MessageSquareText, Plus, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "../api";
import type { Project, SearchHit } from "../types";

export interface PaletteActions {
  projects: Project[];
  currentProject: number | null;
  goProject: (pid: number, view?: string) => void;
  goMyDay: () => void;
  openTask: (pid: number, tid: number) => void;
  newTask: () => void;
  askAI: (prompt: string) => void;
  onClose: () => void;
}

interface Item { id: string; icon: React.ReactNode; label: React.ReactNode; text: string; hint?: string; run: () => void; ai?: boolean }

const VIEWS = ["board", "list", "timeline", "sprint", "insights"];

/** Ctrl/⌘+K: one box to search tasks everywhere, jump anywhere, or hand the request to the AI copilot. */
export function CommandPalette(a: PaletteActions) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => api<SearchHit[]>(`/api/search${qs({ q: q.trim(), limit: 8 })}`).then(setHits).catch(() => setHits([])), 120);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const close = (fn: () => void) => () => { a.onClose(); fn(); };
    const out: Item[] = [];
    // A sentence reads as an instruction for the AI; put it first.
    const looksLikeAsk = term.split(/\s+/).length >= 3 || term.endsWith("?");
    const where = (a.projects.find((p) => p.id === a.currentProject) ?? a.projects[0])?.name;
    const ask: Item | null = term && a.projects.length ? { id: "ai", icon: <MessageSquareText className="i" />, text: q.trim(), label: <>Ask {where}: {q.trim()}</>, hint: "answers from live data", ai: true, run: close(() => a.askAI(q.trim())) } : null;
    if (ask && looksLikeAsk) out.push(ask);
    out.push(...hits.map((h) => ({ id: `t${h.id}`, icon: <FileText className="i" />, text: h.title, label: <><span className="key">{h.key}</span>{h.title}</>, hint: `${h.project_name}, ${h.state}`, run: close(() => a.openTask(h.project_id, h.id)) })));
    const nav: Item[] = [
      { id: "myday", icon: <Sun className="i" />, text: "My day", label: "My day", hint: "plan, your tasks, inbox", run: close(a.goMyDay) },
      ...(a.currentProject ? [{ id: "new", icon: <Plus className="i" />, text: "New task", label: "New task", hint: "C", run: close(a.newTask) }] : []),
      ...a.projects.map((p) => ({ id: `p${p.id}`, icon: <Folder className="i" />, text: p.name, label: p.name, hint: p.key, run: close(() => a.goProject(p.id)) })),
      ...(a.currentProject ? VIEWS.map((v) => ({ id: `v${v}`, icon: <LayoutList className="i" />, text: `${v} view`, label: `${v[0].toUpperCase()}${v.slice(1)} view`, run: close(() => a.goProject(a.currentProject!, v)) })) : []),
    ];
    out.push(...nav.filter((i) => !term || i.text.toLowerCase().includes(term)));
    if (ask && !looksLikeAsk) out.push(ask);
    return out;
  }, [q, hits, a]);

  useEffect(() => setSel(0), [q, hits.length]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); items[sel]?.run(); }
    if (e.key === "Escape") a.onClose();
  };
  return (
    <div className="modal-wrap palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && a.onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input"><Search className="i" aria-hidden />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} role="combobox" aria-expanded="true"
          aria-controls="palette-list" aria-activedescendant={items[sel] ? `pal-${items[sel].id}` : undefined} aria-label="Search or ask"
          placeholder="Find a task or project, or type a question" /></div>
        <ul id="palette-list" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} id={`pal-${it.id}`} role="option" aria-selected={i === sel} className={`${i === sel ? "on" : ""}${it.ai ? " ask" : ""}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
              <span className="ico" aria-hidden="true">{it.icon}</span><span className="grow">{it.label}</span>{it.hint && <small className="muted">{it.hint}</small>}
            </li>
          ))}
          {!items.length && <li className="faint">No tasks or projects match.</li>}
        </ul>
        <footer><span><ArrowDownUp className="i sm" aria-hidden />move</span><span><CornerDownLeft className="i sm" aria-hidden />open</span><span><kbd>Esc</kbd>close</span><span className="spacer" /><span>A full question goes to the project assistant</span></footer>
      </div>
    </div>
  );
}
