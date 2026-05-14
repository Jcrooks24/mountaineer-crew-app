/**
 * Office Hours store — offline-capable list of admin office-hours entries.
 *
 * Model mirrors materialsStore.ts but flatter: each entry is a single object
 * (no per-job grouping). One localStorage cache + a queue of add/edit/delete
 * ops. Rendered list = cache − pending-deletes + pending-adds + applied
 * pending-edits.
 *
 * Why a queue at all (vs. fire-and-forget POST + refetch)?
 *   Admins log a day's hours from the field or a personal device. If the
 *   network is flaky, the entry must survive in the UI and the form
 *   shouldn't appear to "vanish" just because the POST failed once. Same
 *   reliability bar as crew materials.
 */

import { apiFetch, ApiError } from "../api/client";

// ── Types ────────────────────────────────────────────────────────────────────

export type OfficeHoursEntry = {
  entry_uuid: string;
  user_name: string;
  work_date: string;       // ISO YYYY-MM-DD
  start_time: string;      // HH:MM
  end_time: string;        // HH:MM
  break_hours: number;
  hours: number;
  notes: string;
  created_at: string;
  updated_at: string;
  /** True while this entry is still in the local queue. */
  pending?: boolean;
};

export type OfficeHoursInput = {
  entry_uuid: string;
  work_date: string;
  start_time: string;
  end_time: string;
  break_hours: number;
  hours: number;
  notes: string;
};

type QueueOp =
  | { op: "upsert"; payload: OfficeHoursInput; submitted_at: string; user_name: string }
  | { op: "delete"; entry_uuid: string };

// ── Keys ─────────────────────────────────────────────────────────────────────

const OFFICE_HOURS_CACHE_KEY = "crew_office_hours_cache_v1";
const OFFICE_HOURS_QUEUE_KEY = "crew_office_hours_queue_v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function newEntryUuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Net hours = (end - start) - break, in decimal hours. Negative or NaN → 0. */
export function computeHours(start: string, end: string, breakHours: number): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) {
    return 0;
  }
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  // Overnight shifts wrap past midnight — rare for office hours but cheap to support.
  if (endMin < startMin) endMin += 24 * 60;
  const worked = (endMin - startMin) / 60 - (Number(breakHours) || 0);
  return worked > 0 ? Math.round(worked * 100) / 100 : 0;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export function loadCache(): OfficeHoursEntry[] {
  try {
    const raw = localStorage.getItem(OFFICE_HOURS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfficeHoursEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(items: OfficeHoursEntry[]): void {
  try {
    localStorage.setItem(OFFICE_HOURS_CACHE_KEY, JSON.stringify(items));
  } catch {}
}

export function loadQueue(): QueueOp[] {
  try {
    const raw = localStorage.getItem(OFFICE_HOURS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueOp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(ops: QueueOp[]): void {
  try {
    localStorage.setItem(OFFICE_HOURS_QUEUE_KEY, JSON.stringify(ops));
  } catch {}
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** Cache − pending-deletes + applied pending-upserts. Newest work_date first. */
export function rendered(): OfficeHoursEntry[] {
  const cache = loadCache();
  const queue = loadQueue();

  const deleted = new Set<string>();
  const upsertMap = new Map<string, QueueOp & { op: "upsert" }>();
  for (const op of queue) {
    if (op.op === "delete") {
      deleted.add(op.entry_uuid);
      // a pending upsert for an entry we're about to delete is cancelled
      upsertMap.delete(op.entry_uuid);
    } else {
      upsertMap.set(op.payload.entry_uuid, op);
      deleted.delete(op.payload.entry_uuid);
    }
  }

  // Start with cache, drop deletes
  const byUuid = new Map<string, OfficeHoursEntry>();
  for (const e of cache) {
    if (!deleted.has(e.entry_uuid)) byUuid.set(e.entry_uuid, e);
  }
  // Overlay upserts (covers both new entries and edits to existing ones)
  for (const op of upsertMap.values()) {
    byUuid.set(op.payload.entry_uuid, {
      entry_uuid: op.payload.entry_uuid,
      user_name: op.user_name,
      work_date: op.payload.work_date,
      start_time: op.payload.start_time,
      end_time: op.payload.end_time,
      break_hours: op.payload.break_hours,
      hours: op.payload.hours,
      notes: op.payload.notes,
      created_at: op.submitted_at,
      updated_at: op.submitted_at,
      pending: true,
    });
  }

  const list = Array.from(byUuid.values());
  list.sort((a, b) => {
    // newest work_date first, ties broken by created_at
    const dateCmp = b.work_date.localeCompare(a.work_date);
    if (dateCmp !== 0) return dateCmp;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
  return list;
}

export function pendingOpCount(): number {
  return loadQueue().length;
}

// ── Write ────────────────────────────────────────────────────────────────────

export function enqueueUpsert(input: OfficeHoursInput, userName: string): void {
  const q = loadQueue();
  // Collapse multiple edits of the same entry while offline — only the most
  // recent payload matters when we eventually drain.
  const filtered = q.filter(
    (o) => !(o.op === "upsert" && o.payload.entry_uuid === input.entry_uuid),
  );
  filtered.push({
    op: "upsert",
    payload: input,
    submitted_at: new Date().toISOString(),
    user_name: userName,
  });
  saveQueue(filtered);
}

/** If the entry is still a pending upsert, cancel it. Otherwise queue a delete. */
export function enqueueDeleteOrCancel(entry_uuid: string): boolean {
  const q = loadQueue();
  const upsertIdx = q.findIndex(
    (o) => o.op === "upsert" && o.payload.entry_uuid === entry_uuid,
  );
  if (upsertIdx >= 0) {
    q.splice(upsertIdx, 1);
    saveQueue(q);
    return true;
  }
  q.push({ op: "delete", entry_uuid });
  saveQueue(q);
  return false;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

let syncing = false;

export async function syncQueue(): Promise<number> {
  if (!navigator.onLine) return 0;
  if (syncing) return 0;
  syncing = true;
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueueOp[] = [];
    let synced = 0;
    for (const op of q) {
      try {
        if (op.op === "upsert") {
          await apiFetch("/api/office-hours", {
            method: "POST",
            body: JSON.stringify(op.payload),
          });
        } else {
          await apiFetch(`/api/office-hours/${encodeURIComponent(op.entry_uuid)}`, {
            method: "DELETE",
          });
        }
        synced++;
      } catch (e) {
        const isPermanent =
          e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408;
        if (isPermanent) {
          const label = op.op === "delete" ? `delete ${op.entry_uuid}` : `upsert ${op.payload.entry_uuid}`;
          console.warn(
            `[office-hours] dropping poison-pill op (${label}): ${
              e instanceof Error ? e.message : e
            }`,
          );
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

let inFlightFetch: Promise<boolean> | null = null;

export function fetchAndCache(): Promise<boolean> {
  if (!navigator.onLine) return Promise.resolve(false);
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await apiFetch<OfficeHoursEntry[]>("/api/office-hours");
      saveCache(rows);
      return true;
    } catch {
      return false;
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}
