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
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type FeatureRequestInput = {
  request_uuid: string;
  title: string;
  description: string;
  screenshot_urls: string[];
};

const QUEUE_KEY = "crew_feature_request_queue_v1";

function loadQueue(): FeatureRequestInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveQueue(q: FeatureRequestInput[]) {
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

/** Drain queued feature requests. Call on reconnect / app boot. */
export async function drainFeatureRequests(): Promise<void> {
  const q = loadQueue();
  if (!q.length) return;
  const remaining: FeatureRequestInput[] = [];
  for (const r of q) {
    try {
      await postRequest(r);
    } catch {
      remaining.push(r);
    }
  }
  saveQueue(remaining);
}

export function pendingFeatureRequests(): number {
  return loadQueue().length;
}
