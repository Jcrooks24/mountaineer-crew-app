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
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type BugReportInput = {
  bug_uuid: string;
  description: string;
  occurred_date: string;
  screenshot_urls: string[];
};

const QUEUE_KEY = "crew_bug_report_queue_v1";

function loadQueue(): BugReportInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveQueue(q: BugReportInput[]) {
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

/** Drain queued bug reports. Call on reconnect / app boot. */
export async function drainBugReports(): Promise<void> {
  const q = loadQueue();
  if (!q.length) return;
  const remaining: BugReportInput[] = [];
  for (const b of q) {
    try {
      await postBug(b);
    } catch {
      remaining.push(b);
    }
  }
  saveQueue(remaining);
}

export function pendingBugReports(): number {
  return loadQueue().length;
}
