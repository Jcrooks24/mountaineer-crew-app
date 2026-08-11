import { getToken, clearToken } from "../auth/token";

// `?.` so the module is importable outside Vite (dev-tools / node checks),
// where import.meta.env is undefined. In the app Vite always defines it.
const API = (import.meta as any).env?.VITE_API_URL || "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.detail || `API Error ${status}`);
    this.status = status;
    this.body = body;
  }
}

// `isPermanentFailure` used to live here as a SECOND failure classifier
// (allowlist: 400/404/409/422) alongside `queueFailure.isPermanentRejection`
// (denylist: any 4xx except 401/403/408). They disagreed, so whether a crew
// member's queued work survived a given error depended on which store happened
// to be draining. Removed 2026-08-11; there is now exactly one classifier, in
// `lib/queueFailure.ts`. It cannot live here: queueFailure imports ApiError from
// this module, so defining it here and delegating would be circular.
//
// If you are reaching for a failure classifier, import `isPermanentRejection`
// from `lib/queueFailure`. Do not add a second one. See ADR 0013.

export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers = new Headers(opts.headers || {});
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API}${path}`, { ...opts, headers });

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (res.status === 401) clearToken();

  if (!res.ok) throw new ApiError(res.status, body);

  return body as T;
}