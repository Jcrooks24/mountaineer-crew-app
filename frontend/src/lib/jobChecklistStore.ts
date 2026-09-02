/**
 * Job checklist store (C3.3).
 *
 * The checklist template is global config (cached from /api/config/job-checklist).
 * Per-job status is the live AUTO signals + the MANUAL tick state. Manual ticks
 * are offline-safe: an optimistic local update shows immediately, the PUT is
 * queued if offline and drained on reconnect (a tick is never lost in the
 * field). AUTO signals are read-only and only refresh when online.
 */
import { persistJson, StorageFullError } from "./persistQueue";
import { apiFetch } from "../api/client";
import { isPermanentRejection, failureMark, CLEARED_FAILURE, type MaybeFailed } from "./queueFailure";
import { coalesce, invalidate } from "./sharedFetch";

export type ChecklistItem = {
  key: string;
  label: string;
  auto_key: string;
  ld_only: boolean;
  /** Only applies to a job whose header lists a vehicle unit. Optional so a
   *  cached list written by an older build still parses; absent reads as false,
   *  which shows the item, and showing an item that does not apply is the safe
   *  direction to be wrong in. */
  requires_truck?: boolean;
  job_types: string[];
};

export type ChecklistStatus = {
  signals: Record<string, boolean>;
  manual: Record<string, boolean>;
};

const ITEMS_KEY = "crew_job_checklist_items_v1";
const STATUS_KEY = "crew_job_checklist_status_v1";  // job_uuid -> ChecklistStatus
const QUEUE_KEY = "crew_job_checklist_queue_v1";    // "job_uuid|item_key" -> {job_uuid,item_key,checked}

// ── Template items ───────────────────────────────────────────────────────────

export function cachedItems(): ChecklistItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function loadChecklistItems(opts: { force?: boolean } = {}): Promise<ChecklistItem[]> {
  // The checklist TEMPLATE (not the per-job ticks below). Read by every job
  // screen on mount and changed by admin occasionally, so it is the same shape
  // as the other config reads: coalesce concurrent callers, reuse briefly.
  return coalesce(
    "config:job-checklist",
    async () => {
      try {
        const r = await apiFetch<{ items: ChecklistItem[] }>("/api/config/job-checklist");
        const items = Array.isArray(r.items) ? r.items : [];
        // The item LIST is a re-derivable cache (it comes back from the server on
        // the next load), so a failed write here is not data loss - unlike the queue
        // below.
        persistJson(ITEMS_KEY, items);
        return items;
      } catch {
        return cachedItems();
      }
    },
    { ttlMs: 60_000, force: opts.force },
  );
}

/** Call after an admin edits the checklist template. */
export function invalidateChecklistItems(): void {
  invalidate("config:job-checklist");
}

// ── Per-job status ───────────────────────────────────────────────────────────

type StatusBag = Record<string, ChecklistStatus>;

/**
 * A queued manual tick.
 *
 * The `failed_*` fields are local-only and follow ADR 0013: when the server
 * PERMANENTLY refuses a tick, the entry is marked failed and KEPT, never
 * deleted. A failed entry is skipped by the drain (so it cannot jam the queue
 * behind it) and shown to the crew member with the reason, Retry, and Discard.
 * It leaves the queue only when it syncs or when a human discards it.
 */
export type ChecklistQueueEntry = {
  job_uuid: string;
  item_key: string;
  checked: boolean;
} & MaybeFailed;
type QueueBag = Record<string, ChecklistQueueEntry>;

function qkeyOf(jobUuid: string, itemKey: string) {
  return `${jobUuid}|${itemKey}`;
}

function loadBag<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === "object" ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}
/** Returns false if the bag could not be persisted (bug 5, see
 *  lib/persistQueue.ts). The QUEUE bag holds unsent ticks; a silent failure
 *  there loses a crew member's check behind a ticked box. */
function saveBag(key: string, bag: unknown): boolean {
  return persistJson(key, bag);
}

export function cachedStatus(jobUuid: string): ChecklistStatus | null {
  return loadBag<StatusBag>(STATUS_KEY)[jobUuid] ?? null;
}
function cacheStatus(jobUuid: string, s: ChecklistStatus) {
  const bag = loadBag<StatusBag>(STATUS_KEY);
  bag[jobUuid] = s;
  saveBag(STATUS_KEY, bag);
}
function queuedForJob(jobUuid: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const q = loadBag<QueueBag>(QUEUE_KEY);
  for (const v of Object.values(q)) {
    // A failed tick is deliberately NOT overlaid. Showing it as ticked would be
    // the same lie the old delete told: the crew member believes the item is
    // recorded when the server refused it. It shows as unticked, with the
    // failure surfaced separately so they can retry or discard it.
    if (v.job_uuid === jobUuid && !v.failed_at) out[v.item_key] = v.checked;
  }
  return out;
}

/**
 * Undo the optimistic cache write for a tick the server refused.
 *
 * Needed in BOTH rejection paths. `setManualCheck` writes the tick into the
 * status cache before it ever reaches the network, so leaving that write in
 * place means the item still renders as done after a reload even though it was
 * refused - the queue would be honest and the cache would be lying. Dropping
 * the key (rather than setting false) lets the next server load decide, since
 * the item may legitimately be ticked from another device.
 */
function rollbackCachedTick(jobUuid: string, itemKey: string): void {
  const bag = loadBag<StatusBag>(STATUS_KEY);
  const prev = bag[jobUuid];
  if (!prev) return;
  const manual = { ...prev.manual };
  delete manual[itemKey];
  bag[jobUuid] = { ...prev, manual };
  saveBag(STATUS_KEY, bag);
}

/** Failed ticks for a job, for the card to surface. ADR 0013. */
export function failedChecksForJob(jobUuid: string): ChecklistQueueEntry[] {
  return Object.values(loadBag<QueueBag>(QUEUE_KEY))
    .filter((v) => v.job_uuid === jobUuid && v.failed_at);
}

/** Clear the failed mark so the next drain picks it up again. */
export async function retryFailedCheck(jobUuid: string, itemKey: string): Promise<void> {
  const q = loadBag<QueueBag>(QUEUE_KEY);
  const entry = q[qkeyOf(jobUuid, itemKey)];
  if (!entry) return;
  Object.assign(entry, CLEARED_FAILURE);
  saveBag(QUEUE_KEY, q);
  await drainChecklistChecks();
}

/** Explicit, user-initiated delete. The ONLY way a refused tick leaves the
 *  queue without reaching the server (ADR 0013). */
export function discardFailedCheck(jobUuid: string, itemKey: string): void {
  const q = loadBag<QueueBag>(QUEUE_KEY);
  delete q[qkeyOf(jobUuid, itemKey)];
  saveBag(QUEUE_KEY, q);
}

/** Load a job's checklist status. Cached-first; queued (not-yet-synced) manual
 *  ticks are overlaid so an offline toggle stays visible. */
export async function loadChecklistStatus(jobUuid: string): Promise<ChecklistStatus> {
  const overlay = queuedForJob(jobUuid);
  try {
    const r = await apiFetch<ChecklistStatus>(
      `/api/job-checklist/${encodeURIComponent(jobUuid)}/status`,
    );
    const merged: ChecklistStatus = {
      signals: r.signals || {},
      manual: { ...(r.manual || {}), ...overlay },
    };
    cacheStatus(jobUuid, { signals: merged.signals, manual: r.manual || {} });
    return merged;
  } catch {
    const cached = cachedStatus(jobUuid) || { signals: {}, manual: {} };
    return { signals: cached.signals, manual: { ...cached.manual, ...overlay } };
  }
}

/** Toggle a manual item. Optimistic + offline-safe: queues and retries on a
 *  network failure; a server rejection is surfaced, not retried forever. */
export async function setManualCheck(
  jobUuid: string,
  itemKey: string,
  checked: boolean,
): Promise<{ synced: boolean }> {
  // Optimistic cache so the tick survives a reload before it syncs.
  const bag = loadBag<StatusBag>(STATUS_KEY);
  const cur = bag[jobUuid] || { signals: {}, manual: {} };
  cur.manual = { ...cur.manual, [itemKey]: checked };
  bag[jobUuid] = cur;
  saveBag(STATUS_KEY, bag);

  const qkey = `${jobUuid}|${itemKey}`;
  try {
    await apiFetch(`/api/job-checklist/${encodeURIComponent(jobUuid)}/check`, {
      method: "PUT",
      body: JSON.stringify({ item_key: itemKey, checked }),
    });
    const q = loadBag<QueueBag>(QUEUE_KEY);
    if (qkey in q) { delete q[qkey]; saveBag(QUEUE_KEY, q); }
    return { synced: true };
  } catch (e) {
    // Permanent client-error rejection (e.g. bad key): surface it to the caller,
    // which is on screen and can tell the crew member. Roll the optimistic cache
    // back first - throwing while leaving the tick cached would show the item as
    // done after a reload even though the server refused it, which is the same
    // lie ADR 0013 exists to prevent, just told by the cache instead of by the
    // queue. Nothing is queued here: the rejection is already visible, so there
    // is no silent loss to guard against.
    if (isPermanentRejection(e)) {
      rollbackCachedTick(jobUuid, itemKey);
      throw e;
    }
    const q = loadBag<QueueBag>(QUEUE_KEY);
    q[qkey] = { job_uuid: jobUuid, item_key: itemKey, checked };
    if (!saveBag(QUEUE_KEY, q)) {
      // The tick could not be queued (storage full). Roll the cached tick back
      // and throw: leaving the box ticked would show the item done forever with
      // nothing anywhere that will ever send it - the same lie ADR 0013 exists
      // to prevent, told by the cache instead of the queue.
      rollbackCachedTick(jobUuid, itemKey);
      throw new StorageFullError("this checklist tick");
    }
    return { synced: false };
  }
}

/** Drain queued manual ticks. Call on reconnect / app boot.
 *
 *  A permanent rejection MARKS the entry failed and keeps it (ADR 0013). It
 *  used to `delete q[k]` and surface nothing, so a tick the server refused
 *  during a background drain vanished silently and the checkbox reverted with
 *  no explanation. Marked entries are skipped on later drains, so a poison
 *  entry still cannot jam the ticks behind it. */
export async function drainChecklistChecks(): Promise<void> {
  const q = loadBag<QueueBag>(QUEUE_KEY);
  const keys = Object.keys(q);
  if (!keys.length) return;

  const synced: Array<{ k: string; sent: string }> = [];
  const marked: Array<{ k: string; sent: string; mark: MaybeFailed }> = [];

  for (const k of keys) {
    const entry = q[k];
    if (entry.failed_at) continue; // already refused; waits for Retry or Discard
    const { job_uuid, item_key, checked } = entry;
    const sent = JSON.stringify(entry);
    try {
      await apiFetch(`/api/job-checklist/${encodeURIComponent(job_uuid)}/check`, {
        method: "PUT",
        body: JSON.stringify({ item_key, checked }),
      });
      synced.push({ k, sent });
    } catch (e) {
      if (isPermanentRejection(e)) {
        marked.push({ k, sent, mark: failureMark(e) });
        rollbackCachedTick(job_uuid, item_key);
      }
      // Transient (5xx/408/429/401/403) or network: leave it queued untouched.
    }
  }

  // Re-read before writing: a tick toggled during the drain's awaits would
  // otherwise be erased by our stale copy. Act only on entries still identical
  // to what we sent; a changed one is a newer toggle and belongs to the next
  // drain. Same reasoning as jobSetupStore.commitDrain.
  if (!synced.length && !marked.length) return;
  const fresh = loadBag<QueueBag>(QUEUE_KEY);
  for (const { k, sent } of synced) {
    if (fresh[k] && JSON.stringify(fresh[k]) === sent) delete fresh[k];
  }
  for (const { k, sent, mark } of marked) {
    if (fresh[k] && JSON.stringify(fresh[k]) === sent) Object.assign(fresh[k], mark);
  }
  saveBag(QUEUE_KEY, fresh);
}

/** Entries still waiting to sync. Excludes failed ones: those are not pending,
 *  they need a decision, and counting them as pending would make the "unsynced"
 *  indicator never clear. */
export function pendingChecklistChecks(): number {
  return Object.values(loadBag<QueueBag>(QUEUE_KEY)).filter((v) => !v.failed_at).length;
}

/** Count of refused ticks across all jobs. */
export function failedChecklistChecks(): number {
  return Object.values(loadBag<QueueBag>(QUEUE_KEY)).filter((v) => v.failed_at).length;
}
