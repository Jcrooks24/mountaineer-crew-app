import { getToken, clearToken } from "../auth/token";
import { looksLikeRestart, noteServerReachable, noteServerUnavailable } from "../lib/serverStatus";

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

// Retry pacing for a request caught by a backend restart. Four attempts over
// ~7 seconds covers a normal boot (measured at a few seconds) without holding a
// crew member's screen hostage if the server is genuinely down.
//
// USED ONLY WHEN THE SERVER POSITIVELY SAID SO - a 502/503/504 means a proxy
// answered and could not reach the app, which is exactly what a restart looks
// like from outside.
const RESTART_RETRY_DELAYS_MS = [700, 1500, 2500, 3000];

// A failed fetch while the device believes it is online is AMBIGUOUS: either a
// refused connection to a booting server, or one bar in a canyon.
// `navigator.onLine` cannot separate those - it reports true for a phone
// attached to a tower with no usable throughput.
//
// So that case gets ONE fast retry rather than the ladder above. Spending ~7
// seconds before falling back to cached data would have made the app slower for
// exactly the crews with the worst signal, which is the opposite of the point.
// One quick retry still recovers a genuinely refused connection.
const AMBIGUOUS_RETRY_DELAYS_MS = [700];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ONLY these methods are retried automatically.
 *
 * A GET is safe to repeat by definition. A write is not: most of this app's
 * writes are idempotent on a client-minted uuid, but not all of them - the
 * bulletin like endpoint TOGGLES, so a blind retry would silently undo the
 * crew member's tap. Writes are still covered, better, by the offline queues
 * that own them; they surface the banner and drain when the server returns.
 */
function isSafeToRetry(method: string | undefined): boolean {
  const m = (method || "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
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

  // Retry loop for the worker recycle. The backend is recycled every 1000
  // requests BY DESIGN, so a request landing in that window is expected
  // operation, not an incident - and erroring the screen for a few seconds of
  // planned restart is what crews were reporting as the app being broken.
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { ...opts, headers });
    } catch (err) {
      // Network-layer failure: offline, weak signal, or a refused connection to
      // a server that is mid-boot. Ambiguous, so one quick retry only.
      if (looksLikeRestart(err) && isSafeToRetry(opts.method) && attempt < AMBIGUOUS_RETRY_DELAYS_MS.length) {
        noteServerUnavailable();
        await sleep(AMBIGUOUS_RETRY_DELAYS_MS[attempt++]);
        continue;
      }
      if (looksLikeRestart(err)) noteServerUnavailable();
      throw err;
    }

    if (looksLikeRestart(null, res.status)) {
      if (isSafeToRetry(opts.method) && attempt < RESTART_RETRY_DELAYS_MS.length) {
        noteServerUnavailable();
        await sleep(RESTART_RETRY_DELAYS_MS[attempt++]);
        continue;
      }
      noteServerUnavailable();
    } else {
      // Any real answer means the server is up, including a 4xx: the request
      // reached the app and the app replied.
      noteServerReachable();
    }

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
}