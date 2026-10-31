import { ArrowUp, Check, MessageSquareText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../api";
import { useStore } from "../store";
import { Markdown } from "./Markdown";

interface Action { tool: string; input: Record<string, unknown>; ok: boolean; result: string }
interface Msg { role: "user" | "assistant"; content: string; actions?: Action[] }

const SUGGESTIONS = [
  "What could make us miss the sprint, and what should we do first?",
  "Who has too much on? Suggest a fairer split and make it.",
  "Draft the launch checklist as tasks and link them in order.",
  "What changed this week?",
];

const ACTION_LABEL: Record<string, string> = { create_task: "Created task", update_task: "Updated", add_dependency: "Linked", add_comment: "Commented" };

/** Chat panel for the project assistant: Claude with tools over this project's data. */
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
      setErr(e instanceof ApiError && e.status === 503 ? `${e.message}. Everything else in Kairos keeps working.` : (e as Error).message);
      setMsgs(msgs);
      setDraft(text);
    } finally { setBusy(false); }
  };

  return (
    <aside className="copilot" aria-label="Project assistant" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <header><MessageSquareText className="i" aria-hidden /><b>Ask {s.project.name}</b><span className="spacer" /><button className="ghost icon" onClick={onClose} aria-label="Close"><X className="i" /></button></header>
      <div className="chat">
        {!msgs.length && (
          <div className="intro">
            <p>Questions are answered from live project data. Requests to change things are carried out with your permissions, and every change is listed so you can check it.</p>
            {SUGGESTIONS.map((q) => <button key={q} className="suggestion" onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
            {!!m.actions?.length && (
              <div className="actions">
                {m.actions.map((a, j) => (
                  <span key={j} className={`act${a.ok ? "" : " failed"}`} title={a.result}>{a.ok ? <Check className="i sm" aria-label="Done" /> : <X className="i sm" aria-label="Failed" />}{ACTION_LABEL[a.tool] ?? a.tool} {String(a.input.key ?? a.input.title ?? a.input.blocked_key ?? "")}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="thinking" role="status" aria-label="Working"><span /><span /><span /></div>}
        {err && <div className="error" role="alert">{err}</div>}
        <div ref={end} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask a question or describe a change" aria-label="Message" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <button className="primary icon" disabled={busy || !draft.trim()} aria-label="Send"><ArrowUp className="i" /></button>
      </form>
    </aside>
  );
}
