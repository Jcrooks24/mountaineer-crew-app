/**
 * Materials store — offline-capable per-job materials list.
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

import { apiFetch, ApiError } from "../api/client";

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

type QueueOp =
  | { op: "add"; payload: AddPayload }
  | { op: "delete"; submissionId: string; jobUuid: string };

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
    // Quota exceeded or disabled — silently ignore.
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

function saveQueue(ops: QueueOp[]): void {
  try {
    localStorage.setItem(MATERIALS_QUEUE_KEY, JSON.stringify(ops));
  } catch {}
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
      deleted.add(op.submissionId);
    } else if (op.op === "add" && op.payload.job_uuid === jobUuid) {
      pendingAdds.push(...payloadToLiveMaterials(op.payload));
    }
  }

  const base = cache.filter((m) => !deleted.has(m.submissionId));
  const merged = [...pendingAdds, ...base];
  merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return merged;
}

/** Count of queued ops (across all jobs) waiting to sync. */
export function pendingOpCount(): number {
  return loadQueue().length;
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Queue an add for this job. Returns the local submissionId assigned. */
export function enqueueAdd(
  jobUuid: string,
  jobName: string,
  input: AddMaterialInput,
): string {
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
  saveQueue(q);
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
 * Drain the queue. Transient failures (network / 5xx / 408) are retried on
 * next drain — the op stays in the queue. Permanent rejections (4xx except
 * 408) are dropped so one malformed op can't wedge the queue behind it,
 * and a warning is logged so the problem isn't completely invisible.
 * Returns how many ops were confirmed this run.
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
        const isPermanent =
          e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408;
        if (isPermanent) {
          const label = op.op === "delete" ? `delete ${op.submissionId}` : `add ${op.payload.id}`;
          console.warn(
            `[materials] dropping poison-pill op (${label}): ${
              e instanceof Error ? e.message : e
            }`,
          );
          // Drop — do NOT push onto remaining
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
