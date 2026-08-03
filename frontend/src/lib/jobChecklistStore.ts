/**
 * Job checklist store (C3.3).
 *
 * The checklist template is global config (cached from /api/config/job-checklist).
 * Per-job status is the live AUTO signals + the MANUAL tick state. Manual ticks
 * are offline-safe: an optimistic local update shows immediately, the PUT is
 * queued if offline and drained on reconnect (a tick is never lost in the
 * field). AUTO signals are read-only and only refresh when online.
 */
import { apiFetch, isPermanentFailure } from "../api/client";

export type ChecklistItem = {
  key: string;
  label: string;
  auto_key: string;
  ld_only: boolean;
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

export async function loadChecklistItems(): Promise<ChecklistItem[]> {
  try {
    const r = await apiFetch<{ items: ChecklistItem[] }>("/api/config/job-checklist");
    const items = Array.isArray(r.items) ? r.items : [];
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); } catch {}
    return items;
  } catch {
    return cachedItems();
  }
}

// ── Per-job status ───────────────────────────────────────────────────────────

type StatusBag = Record<string, ChecklistStatus>;
type QueueBag = Record<string, { job_uuid: string; item_key: string; checked: boolean }>;

function loadBag<T>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return (parsed && typeof parsed === "object" ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}
function saveBag(key: string, bag: unknown) {
  try { localStorage.setItem(key, JSON.stringify(bag)); } catch {}
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
    if (v.job_uuid === jobUuid) out[v.item_key] = v.checked;
  }
  return out;
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
    // Permanent client-error rejection (e.g. bad key): surface it. Transient
    // (5xx/408/429/401/403) or network: queue and retry on reconnect.
    if (isPermanentFailure(e)) throw e;
    const q = loadBag<QueueBag>(QUEUE_KEY);
    q[qkey] = { job_uuid: jobUuid, item_key: itemKey, checked };
    saveBag(QUEUE_KEY, q);
    return { synced: false };
  }
}

/** Drain queued manual ticks. Call on reconnect / app boot. */
export async function drainChecklistChecks(): Promise<void> {
  const q = loadBag<QueueBag>(QUEUE_KEY);
  const keys = Object.keys(q);
  if (!keys.length) return;
  for (const k of keys) {
    const { job_uuid, item_key, checked } = q[k];
    try {
      await apiFetch(`/api/job-checklist/${encodeURIComponent(job_uuid)}/check`, {
        method: "PUT",
        body: JSON.stringify({ item_key, checked }),
      });
      delete q[k];
    } catch (e) {
      // Drop only a permanent client-error rejection; keep transient + network.
      if (isPermanentFailure(e)) delete q[k];
    }
  }
  saveBag(QUEUE_KEY, q);
}

export function pendingChecklistChecks(): number {
  return Object.keys(loadBag<QueueBag>(QUEUE_KEY)).length;
}
