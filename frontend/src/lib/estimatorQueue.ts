// Persistent queue for estimator item adds. The estimator uses an
// optimistic-add UX — the modal hands a payload to the parent, which drops
// a temp row into the UI immediately and fires the POST in the background.
// Without a persistent queue, a user who navigates away (or loses network)
// before the POST resolves silently loses the item. This queue survives
// reloads and navigations; the EstimateDetail component drains it on
// mount and merges any pending adds into its rendered state.

import { apiFetch, ApiError } from "../api/client";

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
};

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
    /* quota — noop */
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

export function pruneStale(): void {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const q = loadAll().filter((o) => {
    const t = Date.parse(o.createdAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
  saveAll(q);
}

// Drain queued adds for one estimate. `onResolved` fires for each successful
// POST so the caller can swap tempId → server id in its rendered state.
// `onDropped` fires when the server permanently rejects an op (4xx) — the
// caller should remove the temp row. Network errors and 5xx leave the op
// queued for next time.
export async function drain(
  estimateUuid: string,
  onResolved: (tempId: number, server: ServerItem) => void,
  onDropped: (tempId: number, reason: string) => void,
): Promise<void> {
  if (!navigator.onLine) return;
  const q = pendingFor(estimateUuid);
  for (const op of q) {
    try {
      const server = await apiFetch<ServerItem>(
        `/api/estimates/${encodeURIComponent(op.estimateUuid)}/items`,
        { method: "POST", body: JSON.stringify(op.payload) },
      );
      removeOp(op.id);
      onResolved(op.tempId, server);
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 401 &&
        e.status !== 403
      ) {
        // Permanent rejection — drop op, let caller clean UI. 401/403 are
        // excluded: an expired token is transient, and dropping the op would
        // silently lose queued field work — leave it for the next pass.
        removeOp(op.id);
        onDropped(op.tempId, e.message);
      } else {
        // Network / 5xx / timeout / auth — leave queued, stop this pass.
        return;
      }
    }
  }
}
