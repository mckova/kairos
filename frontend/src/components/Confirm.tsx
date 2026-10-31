import { useEffect, useRef } from "react";

/** Small alert dialog for destructive actions: focus starts on Cancel, Escape cancels. */
export function Confirm({ title, body, action, onConfirm, onCancel }: { title: string; body: string; action: string; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => prev?.focus();
  }, []);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onCancel()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h3 id="confirm-title">{title}</h3>
        <p id="confirm-body">{body}</p>
        <div className="modal-actions"><button ref={cancel} className="ghost" onClick={onCancel}>Cancel</button><button className="danger-solid" onClick={onConfirm}>{action}</button></div>
      </div>
    </div>
  );
}
