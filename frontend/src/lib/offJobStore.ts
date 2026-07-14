// Offline-durable off-job hours submission. Off-job work is rare but must
// survive a signal drop, so each submit is queued in localStorage and drained
// (idempotent by entry_uuid) when connectivity returns - mirrors the incident
// queue. No photos, so a simple localStorage queue is enough (no IndexedDB).

import { apiFetch } from "../api/client";
import {
  CLEARED_FAILURE,
  failureMark,
  isPermanentRejection,
  type MaybeFailed,
} from "./queueFailure";

export type PayStructure = "regular" | "non_billable" | "other";

const FIELD_LABELS: Record<string, string> = {
  work_date: "Date",
  start_time: "Start time",
  end_time: "End time",
  hours: "Hours",
  pay_structure: "Pay type",
  pay_other_note: "Pay note",
  notes: "What you worked on",
};

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

// A queued entry, plus the failure mark it carries if the server refused it.
export type QueuedOffJob = OffJobPayload & MaybeFailed;

function loadAll(): QueuedOffJob[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedOffJob[]) : [];
  } catch {
    return [];
  }
}

function saveAll(q: QueuedOffJob[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - noop */
  }
}

function patch(entryUuid: string, fields: MaybeFailed): void {
  saveAll(loadAll().map((x) => (x.entry_uuid === entryUuid ? { ...x, ...fields } : x)));
}

export function enqueueOffJob(p: OffJobPayload): void {
  const q = loadAll().filter((x) => x.entry_uuid !== p.entry_uuid);
  q.push(p);
  saveAll(q);
}

export function pendingOffJob(): QueuedOffJob[] {
  return loadAll();
}

/**
 * Drain queued entries. Idempotent server-side, so a retry is always safe.
 *
 * A permanent 4xx does NOT delete the entry (ADR 0013). Off-job hours feed
 * payroll: silently destroying one because the API refused the payload means a
 * crew member is not paid for work they did, and nobody finds out. It is marked
 * failed instead, skipped by the drain, and shown back to them with a Retry.
 *
 * Returns the uuids rejected on this pass so the submit path can tell the truth.
 */
export async function drainOffJob(): Promise<string[]> {
  if (!navigator.onLine) return [];
  const rejected: string[] = [];
  for (const p of loadAll()) {
    if (p.failed_at) continue; // waiting on a person, not on the network
    try {
      await apiFetch("/api/off-job-hours", { method: "POST", body: JSON.stringify(p) });
      saveAll(loadAll().filter((x) => x.entry_uuid !== p.entry_uuid));
    } catch (e) {
      if (isPermanentRejection(e)) {
        patch(p.entry_uuid, failureMark(e, FIELD_LABELS));
        rejected.push(p.entry_uuid);
      } else {
        return rejected; // transient: stop, retry the whole queue next pass
      }
    }
  }
  return rejected;
}

/**
 * Submit an entry: queue for durability, then try to flush immediately. Returns
 * the failure reason when the server permanently refused it, so the caller does
 * not report success over hours that never landed.
 */
export async function submitOffJob(p: OffJobPayload): Promise<{ failedReason?: string }> {
  enqueueOffJob(p);
  const rejected = await drainOffJob();
  if (rejected.includes(p.entry_uuid)) {
    const entry = loadAll().find((x) => x.entry_uuid === p.entry_uuid);
    return { failedReason: entry?.failed_reason || "The server rejected these hours." };
  }
  return {};
}

/** Clear the failed mark so the next drain picks the entry up again. */
export async function retryFailedOffJob(entryUuid: string): Promise<string[]> {
  patch(entryUuid, CLEARED_FAILURE);
  return drainOffJob();
}

/**
 * Explicit, crew-initiated delete of a failed entry. The ONLY way one leaves the
 * queue without reaching the server. Confirm before calling.
 */
export function discardFailedOffJob(entryUuid: string): void {
  saveAll(loadAll().filter((x) => x.entry_uuid !== entryUuid));
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
