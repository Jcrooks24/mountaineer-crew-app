import { getToken, clearToken } from "../auth/token";

// `?.` so the module is importable outside Vite (dev-tools / node checks),
// where import.meta.env is undefined. In the app Vite always defines it.
const API = (import.meta as any).env?.VITE_API_URL || "http://127.0.0.1:8000";

/**
 * Turn a FastAPI error body into something a person can read.
 *
 * `detail` is a plain string for our own `raise HTTPException(...)`, but on a
 * 422 FastAPI produces a LIST of pydantic error objects. Passing that straight
 * to `Error` stringifies it as "[object Object]", which is what an admin saw
 * when the job-report initialing call failed - a message that says nothing about
 * what went wrong and cannot be searched for.
 */
function describeDetail(detail: any, status: number): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (typeof d === "string") return d;
        // loc is like ["body", "entered_by"]; the field name is the useful half.
        const field = Array.isArray(d?.loc)
          ? d.loc.filter((x: any) => x !== "body").join(".")
          : "";
        const msg = d?.msg || d?.type || "invalid";
        return field ? `${field}: ${msg}` : String(msg);
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  // `!Array.isArray` matters: an array IS an object, so an EMPTY detail list
  // would otherwise stringify to "[]" and be shown to a crew member as the
  // explanation. An empty list explains nothing; fall through to the status.
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    try {
      return JSON.stringify(detail);
    } catch {
      /* fall through */
    }
  }
  return `API Error ${status}`;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(describeDetail(body?.detail, status));
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