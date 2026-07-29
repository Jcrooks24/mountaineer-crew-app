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