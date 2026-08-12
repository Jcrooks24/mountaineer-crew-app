/**
 * RODS store - resumable, tap-recorded Record of Duty Status.
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

import { apiFetch } from "../api/client";
import { persistJson } from "./persistQueue";
import { CLEARED_FAILURE, failureMark, isPermanentRejection, type MaybeFailed } from "./queueFailure";
import { mountainDateYYYYMMDD, mountainHHMM } from "./time";

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
  // No sleeper berth in our trucks: a resting/riding non-driving occupant logs
  // "Passenger" (maps to the FMCSA sleeper/rest status internally).
  sleeper: "Passenger",
  driving: "Driving",
  on_duty: "On Duty",
};

export const STATUS_COLORS: Record<DutyStatus, string> = {
  off_duty: "#6aa7ff",
  sleeper: "#a78bfa",
  driving: "#5dd6c2",
  on_duty: "#fbbf24",
};

// Plain-language explanation of each status and when it applies.
export const STATUS_HELP: Record<DutyStatus, string> = {
  off_duty: "Truck is PARKED and you're on your own time - meal or rest stop, overnight, or done for the day. Not driving and not traveling.",
  sleeper: "Riding in the truck while someone else drives (in transit, not driving) - travel time as a passenger, resting or just along for the ride.",
  driving: "Behind the wheel with the truck moving or stopped in traffic.",
  on_duty: "Working but not driving - loading, unloading, packing, fueling, inspections, paperwork, or waiting to load.",
};

export type RodsDay = {
  rods_id: string;
  log_date: string; // YYYY-MM-DD
  driver_name: string;
  changes: DutyChange[];
  // Job link - enables seeding from the job header + the RODS checklist auto-tick.
  job_uuid?: string;
  job_name?: string;
  // Trip header - carried across days.
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
  // Mountain calendar date - the DOT log's home-terminal tz, not the device's.
  return mountainDateYYYYMMDD();
}

export function nowHHMM(): string {
  // Mountain wall-clock - a phone in Central must not shift the duty time +1h.
  return mountainHHMM(new Date());
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

// Reverse map from a DUTY event's status-label back to the status.
const LABEL_TO_STATUS: Record<string, DutyStatus> = Object.fromEntries(
  DUTY_STATUSES.map((s) => [STATUS_LABELS[s], s]),
) as Record<string, DutyStatus>;

// A DUTY event's note carries BOTH the status label and the driver it's for
// ("Driving · Jane Smith"), so a passenger can log on behalf of a driver and
// each driver's changes group into their own RODS. Multi-driver support hangs
// off this encoding, no event-schema change required.
const DUTY_SEP = " · ";

type MinEvent = { type: string; note?: string | null; timestamp: string };

/** Build a DUTY event note from a status + the driver it's logged for. */
export function dutyEventNote(status: DutyStatus, driverName: string): string {
  const label = STATUS_LABELS[status];
  return driverName ? `${label}${DUTY_SEP}${driverName}` : label;
}

function parseDutyNote(note: string): { status: DutyStatus | null; driver: string } {
  const raw = (note || "").trim();
  const idx = raw.indexOf(DUTY_SEP);
  const label = idx >= 0 ? raw.slice(0, idx).trim() : raw;
  const driver = idx >= 0 ? raw.slice(idx + DUTY_SEP.length).trim() : "";
  return { status: LABEL_TO_STATUS[label] ?? null, driver };
}

/** Distinct driver names that have DUTY events in the log (old notes without a
 * driver fall back to `fallbackDriver`). */
export function rodsDriverNames(events: MinEvent[], fallbackDriver = "", date?: string): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.type !== "DUTY") continue;
    if (date && localDateFromTs(e.timestamp) !== date) continue;
    const p = parseDutyNote(e.note || "");
    if (!p.status) continue;
    set.add(p.driver || fallbackDriver);
  }
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

/** Sorted unique local calendar dates ("YYYY-MM-DD") that have DUTY events -
 * the days a multi-day trip needs a RODS for. */
export function rodsDatesFromEvents(events: MinEvent[]): string[] {
  const set = new Set<string>();
  for (const e of events) {
    if (e.type !== "DUTY") continue;
    const d = localDateFromTs(e.timestamp);
    if (d) set.add(d);
  }
  return [...set].sort();
}

/** Duty changes for ONE driver, derived from the DUTY events. Editing an
 * event's time in the activity log edits the RODS. Begins off-duty at
 * midnight. Within a single minute, the LAST tap wins - lets the crew fix
 * a misclick without leaving a stale earlier entry stuck on the log. */
/** Mountain calendar date ("YYYY-MM-DD") of an ISO timestamp - the DOT log's
 *  home-terminal tz, so a duty event does not change days when the driver's phone
 *  crosses a timezone. */
function localDateFromTs(ts: string): string {
  return mountainDateYYYYMMDD(ts);
}

export function changesForDriver(events: MinEvent[], driver: string, fallbackDriver = "", date?: string): DutyChange[] {
  const duty = events
    .filter((e) => {
      if (e.type !== "DUTY") return false;
      // Per-day RODS: an FMCSA duty log is ONE calendar day. Without this
      // filter a multi-day LD trip collapses EVERY day's duty events into a
      // single 24h timeline sorted by time-of-day - jumbling the duty-time
      // totals and making currentStatus pick a prior night's last tap (the
      // crew-reported "stuck on Off Duty" on day 2, and wrong totals in the
      // Report). When `date` is omitted, behavior is unchanged (single day).
      if (date && localDateFromTs(e.timestamp) !== date) return false;
      const p = parseDutyNote(e.note || "");
      return !!p.status && (p.driver || fallbackDriver) === driver;
    })
    .map((e) => {
      const p = parseDutyNote(e.note || "");
      return {
        _ts: e.timestamp,
        // Mountain wall-clock of the event, matching the log's home-terminal tz.
        time: mountainHHMM(e.timestamp),
        status: p.status as DutyStatus,
        location: "",
        remarks: "",
      };
    })
    // Sort by full timestamp so same-minute events keep their true
    // chronological order regardless of input order. Numeric parse so a
    // "2026-07-03T09:45:12Z" vs "2026-07-03T09:45:12.123+00:00" ordering
    // works correctly - string compare would have given the wrong answer
    // for the fractional-seconds case.
    .sort((a, b) => {
      const ta = Date.parse(String(a._ts));
      const tb = Date.parse(String(b._ts));
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });

  // Collapse consecutive entries that share HH:MM - the latest tap in a
  // given minute is the truth (user corrected a misclick).
  const collapsed: DutyChange[] = [];
  for (const c of duty) {
    const entry: DutyChange = { time: c.time, status: c.status, location: c.location, remarks: c.remarks };
    if (collapsed.length > 0 && collapsed[collapsed.length - 1].time === entry.time) {
      collapsed[collapsed.length - 1] = entry;
    } else {
      collapsed.push(entry);
    }
  }

  return [{ time: "00:00", status: "off_duty", location: "", remarks: "" }, ...collapsed];
}

// ── Per-day persistence ───────────────────────────────────────────────────────

const DAY_PREFIX = "crew_rods_day_v1:";

// Keyed by date AND driver so multiple drivers can each keep a RODS for the
// same day (trip details + signature) on one device.
function dayKey(date: string, driver = ""): string {
  return `${DAY_PREFIX}${date}::${driver}`;
}

export function loadDay(date: string, driver = ""): RodsDay | null {
  try {
    const raw = localStorage.getItem(dayKey(date, driver));
    if (!raw) return null;
    const d = JSON.parse(raw) as RodsDay;
    if (!d || !Array.isArray(d.changes)) return null;
    return d;
  } catch {
    return null;
  }
}

/** Persist a day's log locally. Returns false if storage refused it.
 *  A RODS day is a DOT compliance record, so a failed write must reach the
 *  driver rather than being swallowed behind a signed-off screen. */
export function saveDay(day: RodsDay): boolean {
  return persistJson(dayKey(day.log_date, day.driver_name || ""), day);
}

export function newDay(date: string, driverName: string, carryFrom?: RodsDay | null, jobUuid?: string, jobName?: string): RodsDay {
  return {
    rods_id: newUUID(),
    log_date: date,
    driver_name: driverName,
    // Start the day off-duty at 00:00 (FMCSA logs begin at midnight).
    changes: [{ time: "00:00", status: "off_duty", location: "", remarks: "" }],
    job_uuid: jobUuid || carryFrom?.job_uuid,
    job_name: jobName || carryFrom?.job_name,
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
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw) as RodsDay;
        if (d && Array.isArray(d.changes)) out.push(d);
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.log_date.localeCompare(a.log_date));
}

// ── Submit queue (upsert by day) ──────────────────────────────────────────────

const QUEUE_KEY = "crew_rods_queue_v1";

type QueuedDay = { log_date: string; driver_name: string; payload: Record<string, unknown> } & MaybeFailed;

function loadQueue(): QueuedDay[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as QueuedDay[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Returns false if the queue could not be persisted (bug 5, see
 *  lib/persistQueue.ts). Callers on a capture path MUST surface that. */
function saveQueue(q: QueuedDay[]): boolean {
  return persistJson(QUEUE_KEY, q);
}

function dayToPayload(day: RodsDay): Record<string, unknown> {
  const sorted = [...day.changes].sort((a, b) => minutesOfDay(a.time) - minutesOfDay(b.time));
  const totals = computeTotals(day.changes);
  return {
    rods_id: day.rods_id,
    driver_name: day.driver_name,
    log_date: day.log_date,
    job_uuid: day.job_uuid || null,
    job_name: day.job_name || null,
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
 * same date - only the latest state matters). */
export function enqueueDay(day: RodsDay): boolean {
  const driver = day.driver_name || "";
  const q = loadQueue().filter((x) => !(x.log_date === day.log_date && x.driver_name === driver));
  q.push({ log_date: day.log_date, driver_name: driver, payload: dayToPayload(day) });
  return saveQueue(q);
}

export function pendingCount(): number {
  return loadQueue().filter((o) => !o.failed_at).length;
}

/** Days the server permanently refused, kept for the crew to see and retry. */
export function failedDays(): QueuedDay[] {
  return loadQueue().filter((o) => o.failed_at);
}

function queuedDayKey(o: { log_date: string; driver_name: string }): string {
  return `${o.log_date}::${o.driver_name || ""}`;
}

/** Clear the failed mark so the next drain retries this day. */
export function retryFailedDay(log_date: string, driver_name: string): Promise<number> {
  const key = queuedDayKey({ log_date, driver_name });
  saveQueue(loadQueue().map((o) => (queuedDayKey(o) === key ? { ...o, ...CLEARED_FAILURE } : o)));
  return syncQueue();
}

/** Explicit, crew-initiated delete of a failed day. The only way one leaves the
 * queue without reaching the server. A RODS day is a DOT duty-status record, so
 * confirm before calling. */
export function discardFailedDay(log_date: string, driver_name: string): void {
  const key = queuedDayKey({ log_date, driver_name });
  saveQueue(loadQueue().filter((o) => queuedDayKey(o) !== key));
}

let syncing = false;

/** Drain the RODS submit queue. Transient failures stay queued. A permanent 4xx
 * is MARKED FAILED and kept (ADR 0013), never dropped: a RODS day is a DOT
 * duty-status record and deleting one on a bad payload is a compliance problem,
 * not an annoyance. Failed days are skipped so they can't wedge the queue.
 * Returns count confirmed this run. */
export async function syncQueue(): Promise<number> {
  if (!navigator.onLine || syncing) return 0;
  syncing = true;
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueuedDay[] = [];
    let synced = 0;
    for (const op of q) {
      if (op.failed_at) { remaining.push(op); continue; } // waiting on a person
      try {
        await apiFetch("/api/long-distance/rods", { method: "POST", body: JSON.stringify(op.payload) });
        // Mark the local day submitted.
        const d = loadDay(op.log_date, op.driver_name || "");
        if (d) { d.submitted = true; saveDay(d); }
        synced++;
      } catch (e) {
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

function queueHasDay(date: string, driver = ""): boolean {
  // Match the driver too - the queue is keyed by date::driver, so one driver's
  // queued day must not block a co-driver's remote adoption for the same date.
  return loadQueue().some((o) => o.log_date === date && (o.driver_name || "") === (driver || ""));
}

/** Resolve the working day: adopt the server copy when it's ahead (more changes,
 * or it's signed and local isn't) so the driver can resume on another device or
 * after a dead device. Skips adoption when local has unsynced queued work. */
export async function loadOrResumeDay(date: string, driverName: string): Promise<RodsDay> {
  const local = loadDay(date, driverName);
  const remote = queueHasDay(date, driverName) ? null : await fetchRemoteDay(date, driverName);
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
export async function fetchRemoteDay(date: string, driver = ""): Promise<RodsDay | null> {
  if (!date || !navigator.onLine) return null;
  try {
    const q = `/api/long-distance/rods?log_date=${encodeURIComponent(date)}`
      + (driver ? `&driver=${encodeURIComponent(driver)}` : "");
    const rows = await apiFetch<any[]>(q);
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
