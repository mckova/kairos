import { useEffect, useRef } from "react";
import { auth } from "./api";

export interface RealtimeEvent { event: string; actor_id: number | null; data: any }

/** Subscribes to a project's WebSocket channel with auto-reconnect + keepalive. */
export function useProjectSocket(projectId: number | null, onEvent: (e: RealtimeEvent) => void, onStatus?: (live: boolean) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!projectId || !auth.token) return;
    let ws: WebSocket | null = null, ping: number | undefined, retry: number | undefined, closed = false, attempt = 0;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws/projects/${projectId}?token=${auth.token}`);
      ws.onopen = () => { attempt = 0; onStatus?.(true); ping = window.setInterval(() => ws?.send("ping"), 25000); };
      ws.onmessage = (m) => { try { handler.current(JSON.parse(m.data)); } catch { /* ignore */ } };
      ws.onclose = () => {
        onStatus?.(false); clearInterval(ping);
        if (!closed) retry = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15000));
      };
    };
    connect();
    return () => { closed = true; clearInterval(ping); clearTimeout(retry); ws?.close(); };
  }, [projectId]);
}
