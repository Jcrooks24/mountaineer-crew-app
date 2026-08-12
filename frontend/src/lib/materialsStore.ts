/**
 * Materials store - offline-capable per-job materials list.
 *
 * Model:
 *   - Per-job cache (last-known server state) lives in localStorage under
 *     MATERIALS_CACHE_PREFIX + jobUuid.
 *   - A single global operation queue (adds + deletes across all jobs) lives
 *     under MATERIALS_QUEUE_KEY. Queue entries persist until the backend
 *     confirms them.
 *   - `renderedForJob(jobUuid)` = cache ∪ queued-adds(job) − queued-deletes(job).
 *     Components call it whenever cache or queue changes to get the current
 *     user-visible list (including still-pending offline work).
 *
 * Sync:
 *   - `syncQueue()` drains operations in order. Network failures keep the op
 *     in the queue for retry; a single in-flight guard prevents concurrent
 *     drains from double-posting.
 *   - `fetchAndCache(jobUuid)` refreshes the cache with the server's view.
 *
 * Deletion of a still-unsynced add short-circuits: we simply remove the add
 * from the queue (no DELETE is needed because the server never saw the add).
 */

import { persistJson } from "./persistQueue";
import { apiFetch } from "../api/client";
import { CLEARED_FAILURE, failureMark, isPermanentRejection, type MaybeFailed } from "./queueFailure";

// ── Types ────────────────────────────────────────────────────────────────────

export type LiveMaterial = {
  submissionId: string;
  name: string;
  qty: number;
  unitPrice: number | null;
  baseCost: number | null;
  source: "catalog" | "custom";
  createdAt: string;
  /** True while this item is still in the local queue (not yet confirmed by the server). */
  pending?: boolean;
  /** The server permanently refused this item's add. It is kept, not deleted
   * (ADR 0013); the reason is shown and the crew can retry or discard. */
  failed?: boolean;
  failedReason?: string;
};

export type AddMaterialInput = {
  name: string;
  qty: number;
  unitPrice: number | null;
  baseCost: number | null;
  source: "catalog" | "custom";
};

type ServerItem = {
  id?: string;
  name: string;
  qty: number | string;
  unitPrice?: number | string | null;
  baseCost?: number | string | null;
  source?: string;
};

type ServerSubmission = {
  id: string;
  created_at: string;
  items: ServerItem[];
};

type AddPayload = {
  id: string;
  created_at: string;
  job_uuid: string;
  jobName: string;
  jobLabel: string;
  jobDate: string;
  notes: string;
  items: {
    id: string;
    name: string;
    qty: number;
    unitPrice: number | null;
    baseCost: number | null;
    source: "catalog" | "custom";
  }[];
  total: number;
};

type QueueOp = (
  | { op: "add"; payload: AddPayload }
  | { op: "delete"; submissionId: string; jobUuid: string }
) & MaybeFailed;

// ── Keys ─────────────────────────────────────────────────────────────────────

const MATERIALS_CACHE_PREFIX = "crew_materials_cache_v1:";
const MATERIALS_QUEUE_KEY = "crew_materials_queue_v2";

function cacheKey(jobUuid: string): string {
  return `${MATERIALS_CACHE_PREFIX}${jobUuid || "none"}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toNum(v: unknown, fallback = 0): number {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toNullableNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function flattenSubmissions(subs: ServerSubmission[]): LiveMaterial[] {
  const out: LiveMaterial[] = [];
  for (const sub of subs) {
    for (const it of sub.items || []) {
      out.push({
        submissionId: sub.id,
        name: it.name || "",
        qty: toNum(it.qty),
        unitPrice: toNullableNum(it.unitPrice),
        baseCost: toNullableNum(it.baseCost),
        source: it.source === "custom" ? "custom" : "catalog",
        createdAt: sub.created_at,
      });
    }
  }
  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out;
}

function payloadToLiveMaterials(p: AddPayload): LiveMaterial[] {
  return p.items.map((it) => ({
    submissionId: p.id,
    name: it.name,
    qty: it.qty,
    unitPrice: it.unitPrice,
    baseCost: it.baseCost,
    source: it.source,
    createdAt: p.created_at,
    pending: true,
  }));
}

// ── Storage ──────────────────────────────────────────────────────────────────

export function loadCache(jobUuid: string): LiveMaterial[] {
  try {
    const raw = localStorage.getItem(cacheKey(jobUuid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LiveMaterial[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(jobUuid: string, items: LiveMaterial[]): void {
  try {
    localStorage.setItem(cacheKey(jobUuid), JSON.stringify(items));
  } catch {
    // Quota exceeded or disabled - silently ignore.
  }
}

export function loadQueue(): QueueOp[] {
  try {
    const raw = localStorage.getItem(MATERIALS_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueOp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Returns false if the queue could not be persisted (bug 5, see
 *  lib/persistQueue.ts). A caller on a capture path must surface that rather
 *  than reporting the work saved. */
function saveQueue(ops: QueueOp[]): boolean {
  return persistJson(MATERIALS_QUEUE_KEY, ops);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/** cache ∪ queued-adds(job) − queued-deletes(job). Newest first. */
export function renderedForJob(jobUuid: string): LiveMaterial[] {
  if (!jobUuid) return [];
  const cache = loadCache(jobUuid);
  const queue = loadQueue();

  const deleted = new Set<string>();
  const pendingAdds: LiveMaterial[] = [];
  for (const op of queue) {
    if (op.op === "delete" && op.jobUuid === jobUuid) {
      // A FAILED delete did not reach the server, so the item still exists there
      // and must not be hidden - otherwise the crew think they deleted something
      // that is still on the bill. Only a still-in-flight delete hides the item.
      if (!op.failed_at) deleted.add(op.submissionId);
    } else if (op.op === "add" && op.payload.job_uuid === jobUuid) {
      pendingAdds.push(
        ...payloadToLiveMaterials(op.payload).map((m) => ({
          ...m,
          failed: !!op.failed_at,
          failedReason: op.failed_reason || undefined,
        })),
      );
    }
  }

  const base = cache.filter((m) => !deleted.has(m.submissionId));
  const merged = [...pendingAdds, ...base];
  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return merged;
}

/** Retry a failed add or delete (clear the mark, re-drain). */
export function retryFailedMaterial(submissionId: string): Promise<number> {
  saveQueue(
    loadQueue().map((o) =>
      opSubmissionId(o) === submissionId ? { ...o, ...CLEARED_FAILURE } : o,
    ),
  );
  return syncQueue();
}

/** Discard a failed op. The only path that drops it without reaching the server. */
export function discardFailedMaterial(submissionId: string): void {
  saveQueue(loadQueue().filter((o) => opSubmissionId(o) !== submissionId));
}

function opSubmissionId(o: QueueOp): string {
  return o.op === "add" ? o.payload.id : o.submissionId;
}

/** Count of queued ops (across all jobs) still waiting to sync. Excludes failed
 * ops, which are waiting on a person, not the network. */
export function pendingOpCount(): number {
  return loadQueue().filter((o) => !o.failed_at).length;
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Queue an add for this job. Returns the local submissionId assigned. */
export function enqueueAdd(
  jobUuid: string,
  jobName: string,
  input: AddMaterialInput,
): string | null {
  const submissionId = uuid();
  const itemId = uuid();
  const qty = Math.max(1, Math.floor(input.qty || 1));
  const total = input.unitPrice == null ? 0 : input.unitPrice * qty;

  const payload: AddPayload = {
    id: submissionId,
    created_at: new Date().toISOString(),
    job_uuid: jobUuid,
    jobName,
    jobLabel: jobName,
    jobDate: "",
    notes: "",
    items: [
      {
        id: itemId,
        name: input.name,
        qty,
        unitPrice: input.unitPrice,
        baseCost: input.baseCost,
        source: input.source,
      },
    ],
    total,
  };

  const q = loadQueue();
  q.push({ op: "add", payload });
  // Null when the queue could not be persisted (storage full). Materials are
  // billed, so a silent drop here bills the client for nothing and pays nobody
  // for the run to the supplier.
  if (!saveQueue(q)) return null;
  return submissionId;
}

/**
 * Delete a material. If it's still a pending add in the queue, just remove
 * the add (no server call will be attempted). Otherwise queue a delete op.
 * Returns true if the pending add was canceled (no network call needed).
 */
export function enqueueDeleteOrCancel(submissionId: string, jobUuid: string): boolean {
  const q = loadQueue();
  const addIdx = q.findIndex(
    (o) => o.op === "add" && o.payload.id === submissionId,
  );
  if (addIdx >= 0) {
    q.splice(addIdx, 1);
    saveQueue(q);
    return true;
  }
  q.push({ op: "delete", submissionId, jobUuid });
  saveQueue(q);
  return false;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

// Guard against overlapping drains (visibility + online events can fire close together).
let syncing = false;

/**
 * Drain the queue. Transient failures (network / 5xx / 408 / 401 / 403) are
 * retried on the next drain - the op stays in the queue. A permanent 4xx is
 * MARKED FAILED and KEPT, never dropped (ADR 0013): materials feed billing, and
 * a dropped op silently loses a line item. Failed ops are skipped by the drain
 * (so they can't wedge the queue) and surfaced with Retry/Discard in
 * BillCalculator. Returns how many ops were confirmed this run.
 */
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
      if (op.failed_at) { remaining.push(op); continue; } // waiting on a person
      try {
        if (op.op === "add") {
          await apiFetch("/api/materials", {
            method: "POST",
            body: JSON.stringify(op.payload),
          });
        } else {
          await apiFetch(
            `/api/materials/${encodeURIComponent(op.submissionId)}`,
            { method: "DELETE" },
          );
        }
        synced++;
      } catch (e) {
        // Permanent 4xx: mark failed and KEEP (ADR 0013). Materials feed billing;
        // dropping one silently loses a line item. Transient (network / 5xx /
        // 408 / 401 / 403) stays queued for the next drain.
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

// Per-jobUuid in-flight guard. visibilitychange + focus + online + mount can
// all fire close together on mobile and previously caused a burst of identical
// `GET /api/materials?...&limit=500` calls that OOM'd the 512MB Render worker
// (large response bodies × N concurrent in flight). Subsequent callers ride
// the existing promise instead of opening a second request.
const inFlightFetch = new Map<string, Promise<boolean>>();

/** Refresh the per-job cache from the server. Returns true on success. */
export function fetchAndCache(jobUuid: string): Promise<boolean> {
  if (!jobUuid || !navigator.onLine) return Promise.resolve(false);

  const existing = inFlightFetch.get(jobUuid);
  if (existing) return existing;

  const p = (async (): Promise<boolean> => {
    try {
      const r = await apiFetch<{ ok: boolean; submissions: ServerSubmission[] }>(
        `/api/materials?job_uuid=${encodeURIComponent(jobUuid)}&limit=500`,
      );
      saveCache(jobUuid, flattenSubmissions(r.submissions || []));
      return true;
    } catch {
      return false;
    } finally {
      inFlightFetch.delete(jobUuid);
    }
  })();

  inFlightFetch.set(jobUuid, p);
  return p;
}

/**
 * Convenience: drain queue, then refresh cache. Useful on mount, visibility
 * change, and online reconnect. Returns true if the cache was refreshed.
 */
export async function syncAndFetch(jobUuid: string): Promise<boolean> {
  await syncQueue();
  return fetchAndCache(jobUuid);
}
