// Persistent offline queue for actual-inventory item adds, cloned from
// estimatorQueue. The Actual Inventory section uses an optimistic-add UX: a
// temp row appears immediately and the POST fires in the background. Without
// this queue, a crew member who loses signal (common in the field) or
// navigates away before the POST resolves would silently lose the item. The
// queue survives reloads; the section drains it on mount and merges pending
// adds into its rendered state. Keyed by job_uuid.

import { apiFetch, ApiError } from "../api/client";

// Box pack type: CP (carrier packed), PBO (packed by owner), NA. Null/"" for
// furniture. Required on the client when adding a box.
export type PackType = "CP" | "PBO" | "NA";

export type InventoryItemPayload = {
  name: string;
  qty: number;
  is_box: boolean;
  pack_type: PackType | null;
  room: string | null;
  notes: string | null;
};

export type QueuedAdd = {
  id: string;        // unique queue-op id
  tempId: number;    // negative UI id shown in the rendered list
  jobUuid: string;
  payload: InventoryItemPayload;
  createdAt: string; // ISO
};

export type ServerItem = {
  id: number;
  name: string;
  qty: number;
  is_box: boolean;
  pack_type: PackType | null;
  room: string | null;
  notes: string | null;
};

const QUEUE_KEY = "crew_job_inventory_queue_v1";
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

export function pendingFor(jobUuid: string): QueuedAdd[] {
  return loadAll().filter((o) => o.jobUuid === jobUuid);
}

export function pruneStale(): void {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const q = loadAll().filter((o) => {
    const t = Date.parse(o.createdAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
  saveAll(q);
}

// Drain queued adds for one job. `onResolved` fires per successful POST so the
// caller can swap tempId → server id. `onDropped` fires on a permanent 4xx so
// the caller removes the temp row. Network / 5xx / auth errors leave the op
// queued for the next pass (an expired token is transient; dropping would lose
// field work).
export async function drain(
  jobUuid: string,
  onResolved: (tempId: number, server: ServerItem) => void,
  onDropped: (tempId: number, reason: string) => void,
): Promise<void> {
  if (!navigator.onLine) return;
  const q = pendingFor(jobUuid);
  for (const op of q) {
    try {
      const server = await apiFetch<ServerItem>(
        `/api/job-inventory/${encodeURIComponent(op.jobUuid)}/items`,
        // item_uuid = the queue-op id, which is a crypto.randomUUID() minted
        // once at enqueue and persisted until the op is acked. The server
        // upserts on it, so re-POSTing after a lost response returns the
        // existing row instead of adding the item a second time.
        { method: "POST", body: JSON.stringify({ ...op.payload, item_uuid: op.id }) },
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
        removeOp(op.id);
        onDropped(op.tempId, e.message);
      } else {
        return;
      }
    }
  }
}
