/**
 * Bug report store - crew "Report a Bug" submissions.
 *
 * The report TEXT is never lost: submitBugReport() posts immediately and, if the
 * network is down, queues to localStorage and retries on reconnect (drainable
 * from App.tsx like the other outboxes). Screenshots are best-effort: each is
 * uploaded to Drive at submit time (needs a connection), and the returned URLs
 * ride along on the report. Bug reports are not safety-critical field data, so
 * screenshots requiring a connection is an acceptable trade for a simple store.
 */
import { apiFetch } from "../api/client";
import { isPermanentRejection, failureMark, CLEARED_FAILURE, type MaybeFailed } from "./queueFailure";
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type BugReportInput = {
  bug_uuid: string;
  description: string;
  occurred_date: string;
  screenshot_urls: string[];
};

/** A queued bug report, widened with the ADR 0013 failure mark. */
type QueuedBugReportInput = BugReportInput & MaybeFailed;

const QUEUE_KEY = "crew_bug_report_queue_v1";

function loadQueue(): QueuedBugReportInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedBugReportInput[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - the retry just won't persist across reload */
  }
}
function enqueue(b: BugReportInput) {
  // Idempotent by bug_uuid: replace any earlier queued copy of the same report.
  const q = loadQueue().filter((x) => x.bug_uuid !== b.bug_uuid);
  q.push(b);
  saveQueue(q);
}

export function newBugUuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Upload one screenshot to Drive and return its URL. Raw fetch (not apiFetch)
 * because apiFetch forces a JSON Content-Type, which breaks multipart. */
export async function uploadBugScreenshot(
  file: File | Blob,
  occurredDate: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, (file as File).name || "screenshot.jpg");
  form.append("occurred_date", occurredDate || "");
  const token = getToken() || "";
  const res = await fetch(`${API}/api/bug-report/screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok || !json.url) throw new Error(json?.detail || `HTTP ${res.status}`);
  return json.url as string;
}

async function postBug(b: BugReportInput): Promise<void> {
  await apiFetch("/api/bug-report", { method: "POST", body: JSON.stringify(b) });
}

/** Submit a bug report. Returns whether it reached the server; on failure the
 * report is queued and retried on reconnect (text is never lost). */
export async function submitBugReport(b: BugReportInput): Promise<{ synced: boolean }> {
  try {
    await postBug(b);
    return { synced: true };
  } catch {
    enqueue(b);
    return { synced: false };
  }
}

/** Drain queued bug reports. Call on reconnect / app boot.
 *
 *  This used to `catch { remaining.push(b) }` with no permanent/transient
 *  split at all, so a bug report the server will never accept (a 422 after a schema
 *  change, an oversized 413) was re-POSTed on every boot and every reconnect,
 *  forever, with nothing shown to the person who wrote it. Now a permanent
 *  rejection marks the entry and keeps it (ADR 0013); marked entries are skipped
 *  so one bad bug report cannot wedge the ones behind it. */
export async function drainBugReports(): Promise<void> {
  const q = loadQueue();
  if (!q.length) return;

  const synced: Array<{ id: string; sent: string }> = [];
  const marked: Array<{ id: string; sent: string; mark: MaybeFailed }> = [];

  for (const b of q) {
    if (b.failed_at) continue; // refused; waits for retry or discard
    const sent = JSON.stringify(b);
    try {
      await postBug(b);
      synced.push({ id: b.bug_uuid, sent });
    } catch (e) {
      // Transient (5xx/408/429/401/403) or network: leave it queued untouched.
      if (isPermanentRejection(e)) marked.push({ id: b.bug_uuid, sent, mark: failureMark(e) });
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
      const sent = syncedIds.get(x.bug_uuid);
      return !(sent !== undefined && JSON.stringify(x) === sent);
    }).map((x) => {
      const hit = markedById.get(x.bug_uuid);
      return hit && JSON.stringify(x) === hit.sent ? { ...x, ...hit.mark } : x;
    }),
  );
}

/** Entries still waiting to sync. Excludes failed ones: they need a decision,
 *  and counting them would leave the unsynced indicator permanently lit. */
export function pendingBugReports(): number {
  return loadQueue().filter((x) => !x.failed_at).length;
}

/** Entries the server permanently refused, kept per ADR 0013. */
export function failedBugReportInputs(): QueuedBugReportInput[] {
  return loadQueue().filter((x) => !!x.failed_at);
}

/** Clear the failed mark so the next drain picks it up again. */
export async function retryFailedBugReportInput(id: string): Promise<void> {
  const q = loadQueue();
  const hit = q.find((x) => x.bug_uuid === id);
  if (!hit) return;
  Object.assign(hit, CLEARED_FAILURE);
  saveQueue(q);
  await drainBugReports();
}

/** Explicit, user-initiated delete. The ONLY way a refused entry leaves the
 *  queue without reaching the server (ADR 0013). */
export function discardFailedBugReportInput(id: string): void {
  saveQueue(loadQueue().filter((x) => x.bug_uuid !== id));
}
