/**
 * RODS store — resumable, tap-recorded Record of Duty Status.
 *
 * In long-distance mode the driver taps a duty status (Off Duty / Sleeper /
 * Driving / On Duty) and we append a change stamped with the current time. Each
 * calendar day is its own RODS log, autosaved to localStorage so taps survive
 * an app reload or no signal, and resumable the next day (or a forgotten prior
 * day). "Sign & submit day" attaches the signature + totals and upserts to the
 * backend (idempotent by driver+date, replace-style Sheet row).
 *
 * In-progress taps live only on the device until the day is signed+submitted
 * (the RODS row requires a signature). Same-device resume is fully offline;
 * cross-device mid-day resume arrives once a day is signed.
 */

import { apiFetch, ApiError } from "../api/client";

export type DutyStatus = "off_duty" | "sleeper" | "driving" | "on_duty";

export type DutyChange = {
  time: string; // "HH:MM"
  status: DutyStatus;
  location?: string;
  remarks?: string;
};

export const DUTY_STATUSES: DutyStatus[] = ["off_duty", "sleeper", "driving", "on_duty"];

export const STATUS_LABELS: Record<DutyStatus, string> = {
  off_duty: "Off Duty",
  sleeper: "Sleeper Berth",
  driving: "Driving",
  on_duty: "On Duty",
};

export const STATUS_COLORS: Record<DutyStatus, string> = {
  off_duty: "#6aa7ff",
  sleeper: "#a78bfa",
  driving: "#5dd6c2",
  on_duty: "#fbbf24",
};

export type RodsDay = {
  rods_id: string;
  log_date: string; // YYYY-MM-DD
  driver_name: string;
  changes: DutyChange[];
  // Trip header — carried across days.
  co_driver_name?: string;
  vehicle_number?: string;
  trailer_number?: string;
  origin?: string;
  destination?: string;
  total_miles?: string;
  shipping_docs?: string;
  carrier?: string;
  main_office_address?: string;
  remarks?: string;
  signature?: string;
  signed_at?: string;
  submitted?: boolean; // reached the server at least once
  updated_at: string;
};

// ── Time helpers ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

export function newUUID(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowHHMM(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = (hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(24 * 60, h * 60 + m));
}

export function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${pad(m)}m`;
}

/** Duration per status: each change holds until the next one (or midnight). */
export function computeTotals(changes: DutyChange[]): Record<DutyStatus, number> {
  const totals: Record<DutyStatus, number> = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 };
  if (changes.length === 0) return totals;
  const sorted = [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  for (let i = 0; i < sorted.length; i++) {
    const start = minutesOfDay(sorted[i].time);
    const end = i + 1 < sorted.length ? minutesOfDay(sorted[i + 1].time) : 24 * 60;
    totals[sorted[i].status] += Math.max(0, end - start);
  }
  return totals;
}

/** The status currently in effect (latest change by time). */
export function currentStatus(changes: DutyChange[]): DutyStatus | null {
  if (changes.length === 0) return null;
  return [...changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time)).slice(-1)[0].status;
}

// ── Per-day persistence ───────────────────────────────────────────────────────

const DAY_PREFIX = "crew_rods_day_v1:";

function dayKey(date: string): string {
  return `${DAY_PREFIX}${date}`;
}

export function loadDay(date: string): RodsDay | null {
  try {
    const raw = localStorage.getItem(dayKey(date));
    if (!raw) return null;
    const d = JSON.parse(raw) as RodsDay;
    if (!d || !Array.isArray(d.changes)) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDay(day: RodsDay): void {
  try {
    localStorage.setItem(dayKey(day.log_date), JSON.stringify(day));
  } catch {}
}

export function newDay(date: string, driverName: string, carryFrom?: RodsDay | null): RodsDay {
  return {
    rods_id: newUUID(),
    log_date: date,
    driver_name: driverName,
    // Start the day off-duty at 00:00 (FMCSA logs begin at midnight).
    changes: [{ time: "00:00", status: "off_duty", location: "", remarks: "" }],
    // Carry the trip header forward from the prior day so the driver doesn't re-enter it.
    co_driver_name: carryFrom?.co_driver_name,
    vehicle_number: carryFrom?.vehicle_number,
    trailer_number: carryFrom?.trailer_number,
    origin: carryFrom?.origin,
    destination: carryFrom?.destination,
    total_miles: "",
    shipping_docs: carryFrom?.shipping_docs,
    carrier: carryFrom?.carrier || "Mountaineer Moving Co.",
    main_office_address: carryFrom?.main_office_address,
    updated_at: new Date().toISOString(),
  };
}

/** Local RODS days newest-first (for the "resume a day" list). */
export function listLocalDays(): RodsDay[] {
  const out: RodsDay[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DAY_PREFIX)) continue;
      const d = loadDay(k.slice(DAY_PREFIX.length));
      if (d) out.push(d);
    }
  } catch {}
  return out.sort((a, b) => b.log_date.localeCompare(a.log_date));
}

// ── Submit queue (upsert by day) ──────────────────────────────────────────────

const QUEUE_KEY = "crew_rods_queue_v1";

type QueuedDay = { log_date: string; payload: Record<string, unknown> };

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

function dayToPayload(day: RodsDay): Record<string, unknown> {
  const sorted = [...day.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  const totals = computeTotals(day.changes);
  return {
    rods_id: day.rods_id,
    driver_name: day.driver_name,
    log_date: day.log_date,
    co_driver_name: day.co_driver_name || null,
    vehicle_number: day.vehicle_number || null,
    trailer_number: day.trailer_number || null,
    origin: day.origin || null,
    destination: day.destination || null,
    total_miles: day.total_miles || null,
    shipping_docs: day.shipping_docs || null,
    carrier: day.carrier || null,
    main_office_address: day.main_office_address || null,
    duty_changes: sorted,
    remarks: day.remarks || null,
    total_off_duty: minutesToHHMM(totals.off_duty),
    total_sleeper: minutesToHHMM(totals.sleeper),
    total_driving: minutesToHHMM(totals.driving),
    total_on_duty: minutesToHHMM(totals.on_duty),
    signature: day.signature,
    signed_at: day.signed_at,
  };
}

/** Queue a signed day for upsert (replaces any earlier queued payload for the
 * same date — only the latest state matters). */
export function enqueueDay(day: RodsDay): void {
  const q = loadQueue().filter((x) => x.log_date !== day.log_date);
  q.push({ log_date: day.log_date, payload: dayToPayload(day) });
  saveQueue(q);
}

export function pendingCount(): number {
  return loadQueue().length;
}

let syncing = false;

/** Drain the RODS submit queue. Transient failures stay queued; permanent 4xx
 * are dropped. Returns count confirmed this run. */
export async function syncQueue(): Promise<number> {
  if (!navigator.onLine || syncing) return 0;
  syncing = true;
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueuedDay[] = [];
    let synced = 0;
    for (const op of q) {
      try {
        await apiFetch("/api/long-distance/rods", { method: "POST", body: JSON.stringify(op.payload) });
        // Mark the local day submitted.
        const d = loadDay(op.log_date);
        if (d) { d.submitted = true; saveDay(d); }
        synced++;
      } catch (e) {
        const permanent =
          e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 401 && e.status !== 403;
        if (permanent) {
          console.warn(`[rods] dropping poison-pill day ${op.log_date}: ${e instanceof Error ? e.message : e}`);
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

function queueHasDay(date: string): boolean {
  return loadQueue().some((o) => o.log_date === date);
}

/** Resolve the working day: adopt the server copy when it's ahead (more changes,
 * or it's signed and local isn't) so the driver can resume on another device or
 * after a dead device. Skips adoption when local has unsynced queued work. */
export async function loadOrResumeDay(date: string, driverName: string): Promise<RodsDay> {
  const local = loadDay(date);
  const remote = queueHasDay(date) ? null : await fetchRemoteDay(date);
  if (remote) {
    const adopt =
      !local ||
      (remote.changes.length > local.changes.length) ||
      (!!remote.signature && !local.signature);
    if (adopt) {
      saveDay(remote);
      return remote;
    }
  }
  return local || newDay(date, driverName, listLocalDays().find((x) => x.log_date !== date) || null);
}

/** Fetch a day from the server (signed or in-progress) for cross-device resume. */
export async function fetchRemoteDay(date: string): Promise<RodsDay | null> {
  if (!date || !navigator.onLine) return null;
  try {
    const rows = await apiFetch<any[]>(`/api/long-distance/rods?log_date=${encodeURIComponent(date)}`);
    const r = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!r) return null;
    return {
      rods_id: r.rods_id,
      log_date: r.log_date,
      driver_name: r.driver_name || "",
      changes: Array.isArray(r.duty_changes) ? r.duty_changes : [],
      co_driver_name: r.co_driver_name || undefined,
      vehicle_number: r.vehicle_number || undefined,
      trailer_number: r.trailer_number || undefined,
      origin: r.origin || undefined,
      destination: r.destination || undefined,
      total_miles: r.total_miles || "",
      shipping_docs: r.shipping_docs || undefined,
      carrier: r.carrier || undefined,
      main_office_address: r.main_office_address || undefined,
      remarks: r.remarks || undefined,
      signature: r.signature || undefined,
      signed_at: r.signed_at || undefined,
      submitted: true,
      updated_at: r.created_at || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
