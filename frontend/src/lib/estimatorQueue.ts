// Persistent queue for estimator item adds. The estimator uses an
// optimistic-add UX - the modal hands a payload to the parent, which drops
// a temp row into the UI immediately and fires the POST in the background.
// Without a persistent queue, a user who navigates away (or loses network)
// before the POST resolves silently loses the item. This queue survives
// reloads and navigations; the EstimateDetail component drains it on
// mount and merges any pending adds into its rendered state.

import { apiFetch } from "../api/client";
import { CLEARED_FAILURE, failureMark, isPermanentRejection, type MaybeFailed } from "./queueFailure";

export type EstimateItemPayload = {
  name: string;
  qty: number;
  weight_lbs: number;
  cubic_ft: number;
  room: string | null;
  subcategory: string | null;
  notes: string | null;
};

export type QueuedAdd = {
  id: string;         // unique queue-op id
  tempId: number;     // negative UI id shown in the rendered list
  estimateUuid: string;
  payload: EstimateItemPayload;
  createdAt: string;  // ISO
} & MaybeFailed;

export type ServerItem = {
  id: number;
  name: string;
  qty: number;
  weight_lbs: number;
  cubic_ft: number;
  room: string | null;
  subcategory: string | null;
  notes: string | null;
};

const QUEUE_KEY = "crew_estimator_queue_v1";
const MAX_AGE_DAYS = 14;

function loadAll(): QueuedAdd[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedAdd[]) : [];
  } catch {
    return [];
  }
}

function saveAll(q: QueuedAdd[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - noop */
  }
}

export function enqueue(op: QueuedAdd): void {
  const q = loadAll();
  q.push(op);
  saveAll(q);
}

export function removeOp(opId: string): void {
  const q = loadAll().filter((o) => o.id !== opId);
  saveAll(q);
}

export function cancelByTempId(tempId: number): boolean {
  const q = loadAll();
  const next = q.filter((o) => o.tempId !== tempId);
  if (next.length !== q.length) {
    saveAll(next);
    return true;
  }
  return false;
}

export function pendingFor(estimateUuid: string): QueuedAdd[] {
  return loadAll().filter((o) => o.estimateUuid === estimateUuid);
}

function patch(opId: string, fields: MaybeFailed): void {
  saveAll(loadAll().map((o) => (o.id === opId ? { ...o, ...fields } : o)));
}

/** Clear the failed mark so the next drain retries this add. */
export function retryFailed(opId: string): void {
  patch(opId, CLEARED_FAILURE);
}

/** Explicit, user-initiated delete of a failed add. Only path that drops it
 * without reaching the server. */
export function discardFailed(opId: string): void {
  removeOp(opId);
}

export function pruneStale(): void {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const q = loadAll().filter((o) => {
    // A failed op is waiting on a person, not the network. Ageing it out would
    // destroy the estimate line item on a timer - the same silent loss ADR 0013
    // bans, just slower. It leaves only when the user retries or discards it.
    if (o.failed_at) return true;
    const t = Date.parse(o.createdAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
  saveAll(q);
}

// Drain queued adds for one estimate. `onResolved` fires for each successful
// POST so the caller can swap tempId → server id in its rendered state.
// `onFailed` fires when the server permanently rejects an op (4xx) so the caller
// can render that temp row as "not sent" with the reason. The op is NOT dropped
// (ADR 0013): it stays queued, marked, and leaves only when the user retries or
// discards it. Network errors and 5xx leave the op queued for next time.
export async function drain(
  estimateUuid: string,
  onResolved: (tempId: number, server: ServerItem) => void,
  onFailed: (tempId: number, reason: string) => void,
): Promise<void> {
  if (!navigator.onLine) return;
  const q = pendingFor(estimateUuid);
  for (const op of q) {
    if (op.failed_at) continue; // waiting on a person, not the network
    try {
      const server = await apiFetch<ServerItem>(
        `/api/estimates/${encodeURIComponent(op.estimateUuid)}/items`,
        // item_uuid = the queue-op id, which is a crypto.randomUUID() minted
        // once at enqueue and persisted until the op is acked. The server
        // upserts on it, so re-POSTing after a lost response returns the
        // existing row instead of adding the line item a second time (which
        // would also double-count it in the estimate's weight/volume totals).
        { method: "POST", body: JSON.stringify({ ...op.payload, item_uuid: op.id }) },
      );
      removeOp(op.id);
      onResolved(op.tempId, server);
    } catch (e) {
      if (isPermanentRejection(e)) {
        const mark = failureMark(e);
        patch(op.id, mark);
        onFailed(op.tempId, mark.failed_reason);
      } else {
        // Network / 5xx / timeout / auth - leave queued, stop this pass.
        return;
      }
    }
  }
}
