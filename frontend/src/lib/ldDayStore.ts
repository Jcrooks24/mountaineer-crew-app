/**
 * LD-day store - per-diem / drive-day marks for long-distance trips.
 *
 * The driver marks each day out of town (drives the $50/day per-diem tally) and
 * whether it was a drive day. One record per date, autosaved locally and
 * upserted to the backend (idempotent by driver+date) so it survives offline
 * and syncs on reconnect. Admin reads the payroll totals off the sheet.
 */

import { apiFetch } from "../api/client";
import { CLEARED_FAILURE, failureMark, isPermanentRejection, type MaybeFailed } from "./queueFailure";
import { readActiveJob } from "./bolStore";

export type LdDay = {
  day_id: string;
  date: string; // YYYY-MM-DD
  job_uuid: string;
  job_name: string;
  driver_name?: string;
  out_of_town: boolean;
  drive_day: boolean;
  per_diem?: number;
  updated_at: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newUUID(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Per-date persistence ──────────────────────────────────────────────────────

const DAY_PREFIX = "crew_ld_day_v1:";

export function loadLdDay(date: string): LdDay | null {
  try {
    const raw = localStorage.getItem(DAY_PREFIX + date);
    return raw ? (JSON.parse(raw) as LdDay) : null;
  } catch {
    return null;
  }
}

function saveLdDay(day: LdDay): void {
  try {
    localStorage.setItem(DAY_PREFIX + day.date, JSON.stringify(day));
  } catch {}
}

/** Set fields on a date's record (creating it, attaching the active job), then
 * queue the upsert. */
export function setLdDay(date: string, patch: Partial<Pick<LdDay, "out_of_town" | "drive_day">>): LdDay {
  const job = readActiveJob();
  const existing = loadLdDay(date);
  const day: LdDay = existing
    ? { ...existing, ...patch, updated_at: new Date().toISOString() }
    : {
        day_id: newUUID(),
        date,
        job_uuid: job.job_uuid || "",
        job_name: job.job_name || "",
        out_of_town: false,
        drive_day: false,
        ...patch,
        updated_at: new Date().toISOString(),
      };
  if (!day.job_uuid && job.job_uuid) {
    day.job_uuid = job.job_uuid;
    day.job_name = job.job_name || "";
  }
  saveLdDay(day);
  enqueue(day);
  return day;
}

// ── Upsert queue ──────────────────────────────────────────────────────────────

const QUEUE_KEY = "crew_ld_day_queue_v1";

type QueuedDay = { date: string; payload: Record<string, unknown> } & MaybeFailed;

function loadQueue(): QueuedDay[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedDay[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedDay[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

function enqueue(day: LdDay): void {
  const payload = {
    day_id: day.day_id,
    date: day.date,
    job_uuid: day.job_uuid,
    job_name: day.job_name,
    out_of_town: day.out_of_town,
    drive_day: day.drive_day,
  };
  const q = loadQueue().filter((x) => x.date !== day.date);
  q.push({ date: day.date, payload });
  saveQueue(q);
}

/** Days the server permanently refused, kept for retry (ADR 0013). */
export function failedLdDays(): QueuedDay[] {
  return loadQueue().filter((o) => o.failed_at);
}

export function retryFailedLdDay(date: string): Promise<number> {
  saveQueue(loadQueue().map((o) => (o.date === date ? { ...o, ...CLEARED_FAILURE } : o)));
  return syncQueue();
}

export function discardFailedLdDay(date: string): void {
  saveQueue(loadQueue().filter((o) => o.date !== date));
}

let syncing = false;

export async function syncQueue(): Promise<number> {
  if (!navigator.onLine || syncing) return 0;
  syncing = true;
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueuedDay[] = [];
    let synced = 0;
    for (const op of q) {
      if (op.failed_at) { remaining.push(op); continue; }
      try {
        await apiFetch("/api/long-distance/day", { method: "POST", body: JSON.stringify(op.payload) });
        synced++;
      } catch (e) {
        // A permanent 4xx is marked failed and KEPT, not dropped (ADR 0013).
        // These records feed per-diem and drive-day pay.
        if (isPermanentRejection(e)) {
          remaining.push({ ...op, ...failureMark(e) });
        } else {
          remaining.push(op);
        }
      }
    }
    saveQueue(remaining);
    return synced;
  } finally {
    syncing = false;
  }
}

/** All crew members' day records for a trip (for the Report per-diem tally). */
export async function fetchTripDays(jobUuid: string): Promise<LdDay[]> {
  if (!jobUuid || !navigator.onLine) return [];
  try {
    const r = await apiFetch<{ ok: boolean; days: LdDay[] }>(`/api/long-distance/day?job_uuid=${encodeURIComponent(jobUuid)}`);
    return r.days || [];
  } catch {
    return [];
  }
}

/** Adopt this driver's server record for a date (cross-device continuity), so a
 * second device shows a toggle set elsewhere. Skips when a local toggle is still
 * queued (unsynced), to avoid clobbering it. Returns the adopted record or null. */
export async function hydrateDay(date: string): Promise<LdDay | null> {
  if (!date || !navigator.onLine) return null;
  if (loadQueue().some((o) => o.date === date)) return null;
  try {
    const r = await apiFetch<{ ok: boolean; days: LdDay[] }>(`/api/long-distance/day`);
    const remote = (r.days || []).find((d) => d.date === date);
    if (!remote) return null;
    saveLdDay(remote);
    return remote;
  } catch {
    return null;
  }
}
