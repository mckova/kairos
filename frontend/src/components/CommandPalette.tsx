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

interface Item { id: string; icon: string; label: string; hint?: string; run: () => void; ai?: boolean }

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
    const ask: Item | null = term && a.projects.length ? { id: "ai", icon: "✦", label: `Ask Copilot: “${q.trim()}”`, hint: `AI works in ${(a.projects.find((p) => p.id === a.currentProject) ?? a.projects[0]).name}`, ai: true, run: close(() => a.askAI(q.trim())) } : null;
    if (ask && looksLikeAsk) out.push(ask);
    out.push(...hits.map((h) => ({ id: `t${h.id}`, icon: "◇", label: `${h.key}  ${h.title}`, hint: `${h.project_name} · ${h.state}`, run: close(() => a.openTask(h.project_id, h.id)) })));
    const nav: Item[] = [
      { id: "myday", icon: "☀", label: "My day: plan, my tasks, inbox", run: close(a.goMyDay) },
      ...(a.currentProject ? [{ id: "new", icon: "＋", label: "New task", hint: "C", run: close(a.newTask) }] : []),
      ...a.projects.map((p) => ({ id: `p${p.id}`, icon: "●", label: `Go to ${p.name}`, hint: p.key, run: close(() => a.goProject(p.id)) })),
      ...(a.currentProject ? VIEWS.map((v) => ({ id: `v${v}`, icon: "▸", label: `Open ${v} view`, run: close(() => a.goProject(a.currentProject!, v)) })) : []),
    ];
    out.push(...nav.filter((i) => !term || i.label.toLowerCase().includes(term)));
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
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} role="combobox" aria-expanded="true"
          aria-controls="palette-list" aria-activedescendant={items[sel] ? `pal-${items[sel].id}` : undefined} aria-label="Search or ask"
          placeholder="Search tasks, jump to a project, or ask the AI anything…" />
        <ul id="palette-list" role="listbox">
          {items.map((it, i) => (
            <li key={it.id} id={`pal-${it.id}`} role="option" aria-selected={i === sel} className={`${i === sel ? "on" : ""}${it.ai ? " ai" : ""}`} onMouseEnter={() => setSel(i)} onClick={it.run}>
              <span className="ico" aria-hidden="true">{it.icon}</span><span className="grow">{it.label}</span>{it.hint && <small className="muted">{it.hint}</small>}
            </li>
          ))}
          {!items.length && <li className="muted">No matches</li>}
        </ul>
        <footer className="muted"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span><span className="spacer" /><span>✦ type a sentence to ask Claude</span></footer>
      </div>
    </div>
  );
}
