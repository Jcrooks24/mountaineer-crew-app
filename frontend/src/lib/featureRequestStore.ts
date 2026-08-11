/**
 * Feature request store - crew "Request a Feature" submissions.
 *
 * Mirrors bugReportStore. The request TEXT is never lost: submitFeatureRequest()
 * posts immediately and, if the network is down, queues to localStorage and
 * retries on reconnect (drainable from App.tsx). Screenshots/mockups are
 * best-effort: each uploads to Drive at submit time and the returned URLs ride
 * along on the request.
 */
import { apiFetch } from "../api/client";
import { isPermanentRejection, failureMark, CLEARED_FAILURE, type MaybeFailed } from "./queueFailure";
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type FeatureRequestInput = {
  request_uuid: string;
  title: string;
  description: string;
  screenshot_urls: string[];
};

/** A queued feature request, widened with the ADR 0013 failure mark. */
type QueuedFeatureRequestInput = FeatureRequestInput & MaybeFailed;

const QUEUE_KEY = "crew_feature_request_queue_v1";

function loadQueue(): QueuedFeatureRequestInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedFeatureRequestInput[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - the retry just won't persist across reload */
  }
}
function enqueue(r: FeatureRequestInput) {
  // Idempotent by request_uuid: replace any earlier queued copy.
  const q = loadQueue().filter((x) => x.request_uuid !== r.request_uuid);
  q.push(r);
  saveQueue(q);
}

export function newRequestUuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Upload one screenshot/mockup to Drive and return its URL. Raw fetch (not
 *  apiFetch) because apiFetch forces a JSON Content-Type, which breaks multipart. */
export async function uploadFeatureScreenshot(file: File | Blob): Promise<string> {
  const form = new FormData();
  form.append("file", file, (file as File).name || "feature.jpg");
  const token = getToken() || "";
  const res = await fetch(`${API}/api/feature-request/screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok || !json.url) throw new Error(json?.detail || `HTTP ${res.status}`);
  return json.url as string;
}

async function postRequest(r: FeatureRequestInput): Promise<void> {
  await apiFetch("/api/feature-request", { method: "POST", body: JSON.stringify(r) });
}

/** Submit a feature request. Returns whether it reached the server; on failure
 *  the request is queued and retried on reconnect (text is never lost). */
export async function submitFeatureRequest(r: FeatureRequestInput): Promise<{ synced: boolean }> {
  try {
    await postRequest(r);
    return { synced: true };
  } catch {
    enqueue(r);
    return { synced: false };
  }
}

/** Drain queued feature requests. Call on reconnect / app boot.
 *
 *  This used to `catch { remaining.push(r) }` with no permanent/transient
 *  split at all, so a feature request the server will never accept (a 422 after a schema
 *  change, an oversized 413) was re-POSTed on every boot and every reconnect,
 *  forever, with nothing shown to the person who wrote it. Now a permanent
 *  rejection marks the entry and keeps it (ADR 0013); marked entries are skipped
 *  so one bad feature request cannot wedge the ones behind it. */
export async function drainFeatureRequests(): Promise<void> {
  const q = loadQueue();
  if (!q.length) return;

  const synced: Array<{ id: string; sent: string }> = [];
  const marked: Array<{ id: string; sent: string; mark: MaybeFailed }> = [];

  for (const r of q) {
    if (r.failed_at) continue; // refused; waits for retry or discard
    const sent = JSON.stringify(r);
    try {
      await postRequest(r);
      synced.push({ id: r.request_uuid, sent });
    } catch (e) {
      // Transient (5xx/408/429/401/403) or network: leave it queued untouched.
      if (isPermanentRejection(e)) marked.push({ id: r.request_uuid, sent, mark: failureMark(e) });
    }
  }

  // Re-read before writing. A submission made during the drain's awaits calls
  // enqueue() synchronously; writing our own stale copy back would erase it,
  // and the person who wrote it would never know. Act only on entries still
  // identical to what we sent - a changed one is a newer submission under the
  // same uuid and belongs to the next drain. See jobSetupStore.commitDrain.
  if (!synced.length && !marked.length) return;
  const fresh = loadQueue();
  const syncedIds = new Map(synced.map((x) => [x.id, x.sent]));
  const markedById = new Map(marked.map((x) => [x.id, x]));
  saveQueue(
    fresh.filter((x) => {
      const sent = syncedIds.get(x.request_uuid);
      return !(sent !== undefined && JSON.stringify(x) === sent);
    }).map((x) => {
      const hit = markedById.get(x.request_uuid);
      return hit && JSON.stringify(x) === hit.sent ? { ...x, ...hit.mark } : x;
    }),
  );
}

/** Entries still waiting to sync. Excludes failed ones: they need a decision,
 *  and counting them would leave the unsynced indicator permanently lit. */
export function pendingFeatureRequests(): number {
  return loadQueue().filter((x) => !x.failed_at).length;
}

/** Entries the server permanently refused, kept per ADR 0013. */
export function failedFeatureRequestInputs(): QueuedFeatureRequestInput[] {
  return loadQueue().filter((x) => !!x.failed_at);
}

/** Clear the failed mark so the next drain picks it up again. */
export async function retryFailedFeatureRequestInput(id: string): Promise<void> {
  const q = loadQueue();
  const hit = q.find((x) => x.request_uuid === id);
  if (!hit) return;
  Object.assign(hit, CLEARED_FAILURE);
  saveQueue(q);
  await drainFeatureRequests();
}

/** Explicit, user-initiated delete. The ONLY way a refused entry leaves the
 *  queue without reaching the server (ADR 0013). */
export function discardFailedFeatureRequestInput(id: string): void {
  saveQueue(loadQueue().filter((x) => x.request_uuid !== id));
}
