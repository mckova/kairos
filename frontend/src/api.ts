const TOKEN_KEY = "kairos.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set(token: string) { localStorage.setItem(TOKEN_KEY, token); },
  clear() { localStorage.removeItem(TOKEN_KEY); },
};

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let body = init.body;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body });
  if (res.status === 401 && auth.token) { auth.clear(); location.reload(); }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : j.detail?.[0]?.msg ?? msg;
    } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const qs = (o: Record<string, unknown>) =>
  "?" + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
