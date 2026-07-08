// Offline-durable off-job hours submission. Off-job work is rare but must
// survive a signal drop, so each submit is queued in localStorage and drained
// (idempotent by entry_uuid) when connectivity returns - mirrors the incident
// queue. No photos, so a simple localStorage queue is enough (no IndexedDB).

import { apiFetch, ApiError } from "../api/client";

export type PayStructure = "regular" | "non_billable" | "other";

export const PAY_STRUCTURE_LABELS: Record<PayStructure, string> = {
  regular: "Regular rate",
  non_billable: "Non-billable",
  other: "Other",
};

export type OffJobPayload = {
  entry_uuid: string;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  pay_structure: PayStructure;
  pay_other_note: string | null;
  notes: string;
};

export type OffJobOut = {
  id: number;
  entry_uuid: string;
  submitted_by_name: string | null;
  work_date: string | null;
  start_time: string | null;
  end_time: string | null;
  hours: number;
  pay_structure: PayStructure;
  pay_other_note: string | null;
  notes: string;
  created_at: string;
};

const QUEUE_KEY = "crew_off_job_queue_v1";

function loadAll(): OffJobPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OffJobPayload[]) : [];
  } catch {
    return [];
  }
}

function saveAll(q: OffJobPayload[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - noop */
  }
}

export function enqueueOffJob(p: OffJobPayload): void {
  const q = loadAll().filter((x) => x.entry_uuid !== p.entry_uuid);
  q.push(p);
  saveAll(q);
}

export function pendingOffJob(): OffJobPayload[] {
  return loadAll();
}

// Drain queued entries. Idempotent server-side, so a retry is always safe.
export async function drainOffJob(): Promise<void> {
  if (!navigator.onLine) return;
  for (const p of loadAll()) {
    try {
      await apiFetch("/api/off-job-hours", { method: "POST", body: JSON.stringify(p) });
      saveAll(loadAll().filter((x) => x.entry_uuid !== p.entry_uuid));
    } catch (e) {
      // Permanent client error (bad data) → drop so it can't wedge the queue.
      // Network / auth / 5xx → stop and retry the whole queue next pass.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 408) {
        saveAll(loadAll().filter((x) => x.entry_uuid !== p.entry_uuid));
      } else {
        return;
      }
    }
  }
}

// Submit an entry: queue for durability, then try to flush immediately.
export async function submitOffJob(p: OffJobPayload): Promise<void> {
  enqueueOffJob(p);
  await drainOffJob();
}

export async function fetchMyOffJob(): Promise<OffJobOut[]> {
  return apiFetch<OffJobOut[]>("/api/off-job-hours");
}

export function newOffJobUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `oj-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

// Compute decimal hours from HH:MM start/end (handles a crossed-midnight span).
export function hoursFromTimes(start: string, end: string): number | null {
  const parse = (t: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
    return h * 60 + mm;
  };
  const s = parse(start);
  const e = parse(end);
  if (s === null || e === null) return null;
  let span = e - s;
  if (span <= 0) span += 24 * 60;
  return Math.round((span / 60) * 100) / 100;
}
