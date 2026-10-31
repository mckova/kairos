import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

interface Action { tool: string; input: Record<string, unknown>; ok: boolean; result: string }
interface Msg { role: "user" | "assistant"; content: string; actions?: Action[] }

const SUGGESTIONS = [
  "What's at risk in this sprint, and what should we do first?",
  "Who is overloaded? Rebalance the work.",
  "Create tasks for a public launch checklist and link them in order.",
  "Summarize what changed this week.",
];

const ACTION_LABEL: Record<string, string> = { create_task: "Created task", update_task: "Updated", add_dependency: "Linked", add_comment: "Commented" };

/** Chat panel for the project copilot - Claude with tools over this project's data. */
export function Copilot({ onClose, initial }: { onClose: () => void; initial?: string }) {
  const s = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const sentInitial = useRef("");
  useEffect(() => { if (initial && sentInitial.current !== initial) { sentInitial.current = initial; send(initial); } }, [initial]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: text.trim() }];
    setMsgs(next); setDraft(""); setBusy(true); setErr("");
    try {
      const r = await api<{ reply: string; actions: Action[] }>(`/api/projects/${s.project.id}/ai/chat`, {
        method: "POST", json: { messages: next.map(({ role, content }) => ({ role, content })) },
      });
      setMsgs([...next, { role: "assistant", content: r.reply, actions: r.actions }]);
      if (r.actions.some((a) => a.ok)) s.reload();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 503 ? `${e.message}. The rest of Kairos works without AI.` : (e as Error).message);
      setMsgs(msgs);
      setDraft(text);
    } finally { setBusy(false); }
  };

  return (
    <aside className="copilot" aria-label="AI copilot">
      <header><span className="spark">✦</span><b>Copilot</b><small className="muted">Claude Opus 5.5 · acts with your permissions</small><span className="spacer" /><button className="ghost" onClick={onClose} aria-label="Close">✕</button></header>
      <div className="chat">
        {!msgs.length && (
          <div className="intro">
            <p>Ask about the project or tell me what to change. I read live data and can create, update and link tasks.</p>
            {SUGGESTIONS.map((q) => <button key={q} className="suggestion" onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
            {!!m.actions?.length && (
              <div className="actions">
                {m.actions.map((a, j) => (
                  <span key={j} className={`act${a.ok ? "" : " failed"}`} title={a.result}>{a.ok ? "✓" : "✕"} {ACTION_LABEL[a.tool] ?? a.tool} {String(a.input.key ?? a.input.title ?? a.input.blocked_key ?? "")}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="bubble assistant thinking"><span /><span /><span /></div>}
        {err && <div className="error">{err}</div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask or instruct… (Enter to send)" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <button className="primary" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
