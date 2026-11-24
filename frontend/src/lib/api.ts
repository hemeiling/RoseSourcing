// Thin fetch wrapper. All calls are same-origin (/api) so the session cookie is sent automatically.

import { translate } from "./i18n";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** True when the server reports a missing API key / provider configuration. */
  get isConfigError(): boolean {
    return this.code === "ai_not_configured" || this.code === "research_not_configured";
  }
}

function messageFrom(detail: unknown, fallback: string): { message: string; code?: string } {
  if (!detail) return { message: fallback };
  if (typeof detail === "string") return { message: detail };
  if (Array.isArray(detail)) {
    const parts = detail.map((d: { loc?: unknown[]; msg?: string }) =>
      d?.msg ? `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}` : JSON.stringify(d),
    );
    return { message: parts.join("; ") };
  }
  if (typeof detail === "object") {
    const d = detail as { message?: string; code?: string };
    return { message: d.message ?? fallback, code: d.code };
  }
  return { message: fallback };
}

type Opts = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

// The hosting proxy answers 502/503/504 with its own HTML page when the server is busy, waking up or restarting.
const BUSY = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 5000]; // read-only requests retry quietly before showing an error
const busyMessage = (status: number) => translate("The server is busy or restarting ({status}). Wait a moment and try again - nothing was lost.", { status });

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"), credentials: "include", signal: opts.signal };
  if (opts.form) {
    init.body = opts.form;
  } else if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(opts.body);
  }
  let res: Response | null = null;
  // Only GETs are retried: repeating a POST could start a run or save a record twice.
  const retries = init.method === "GET" ? RETRY_DELAYS_MS : [];
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(path, init);
      if (!BUSY.has(res.status) || attempt >= retries.length) break;
    } catch {
      if (opts.signal?.aborted || attempt >= retries.length) throw new ApiError(0, translate("Network error - the server could not be reached."));
    }
    await new Promise((r) => setTimeout(r, retries[attempt]));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (typeof data === "string") {
      // Not our API's JSON (e.g. the proxy's HTML error page): never show the raw page.
      throw new ApiError(res.status, BUSY.has(res.status) ? busyMessage(res.status) : translate("Request failed ({status}).", { status: res.status }));
    }
    const { message, code } = messageFrom((data as { detail?: unknown })?.detail ?? data, translate("Request failed ({status})", { status: res.status }));
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("aicos:unauthorized"));
    }
    throw new ApiError(res.status, message, code);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body });
export const del = (path: string) => api<void>(path, { method: "DELETE" });
export const upload = <T>(path: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api<T>(path, { method: "POST", form });
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
