// Persistent offline queue for actual-inventory item adds, cloned from
// estimatorQueue. The Actual Inventory section uses an optimistic-add UX: a
// temp row appears immediately and the POST fires in the background. Without
// this queue, a crew member who loses signal (common in the field) or
// navigates away before the POST resolves would silently lose the item. The
// queue survives reloads; the section drains it on mount and merges pending
// adds into its rendered state. Keyed by job_uuid.

import { apiFetch } from "../api/client";
import {
  CLEARED_FAILURE,
  failureMark,
  isPermanentRejection,
  type MaybeFailed,
} from "./queueFailure";

const FIELD_LABELS: Record<string, string> = {
  name: "Item name",
  qty: "Quantity",
  pack_type: "Pack type",
  room: "Room",
  notes: "Notes",
};

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
} & MaybeFailed;

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

function patch(opId: string, fields: MaybeFailed): void {
  saveAll(loadAll().map((o) => (o.id === opId ? { ...o, ...fields } : o)));
}

export function pendingFor(jobUuid: string): QueuedAdd[] {
  return loadAll().filter((o) => o.jobUuid === jobUuid);
}

/** Clear the failed mark so the next drain picks the op up again. */
export function retryFailed(opId: string): void {
  patch(opId, CLEARED_FAILURE);
}

/**
 * Rewrite a queued box's pack type before it is sent.
 *
 * "Apply CP to all boxes" has to reach the boxes that have not synced yet. Those
 * have no server id, so there is nothing to PATCH: the only copy of their pack
 * type is the payload sitting in this queue. Editing the row on screen without
 * editing the payload would show the crew a pack type that never arrives.
 */
export function setQueuedPackType(opId: string, packType: PackType): void {
  saveAll(
    loadAll().map((o) =>
      o.id === opId && o.payload.is_box
        ? { ...o, payload: { ...o.payload, pack_type: packType } }
        : o,
    ),
  );
}

/** Explicit, crew-initiated delete of a failed op. The only way one leaves the
 *  queue without reaching the server. */
export function discardFailed(opId: string): void {
  removeOp(opId);
}

export function pruneStale(): void {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const q = loadAll().filter((o) => {
    // A failed op is waiting on a person, not on the network. Ageing it out would
    // destroy the crew member's work on a timer, which is the same silent loss
    // ADR 0013 bans, just slower. It leaves only when they say so.
    if (o.failed_at) return true;
    const t = Date.parse(o.createdAt);
    return !Number.isFinite(t) || t >= cutoff;
  });
  saveAll(q);
}

// Drain every queued add, across all jobs, with no UI callbacks.
//
// Inventory logging is hidden on local jobs (ADR 0015), and the per-job drain
// below only ever runs while ActualInventory is mounted. Without this, an item
// a crew member queued offline on a local job before that change shipped would
// sit in localStorage forever: nothing would mount to drain it, and pruneStale
// would eventually throw the work away. So the app drains the whole queue on
// boot and on reconnect, regardless of which tab (or mode) the crew are in.
// Same failure policy as drain(): a permanent 4xx MARKS the op failed and leaves
// it in the queue (ADR 0013), anything transient leaves it queued for the next
// pass. This path has no UI attached, so it must never be the one that destroys
// an item nobody is watching.
export async function drainAll(): Promise<void> {
  if (!navigator.onLine) return;
  for (const op of loadAll()) {
    if (op.failed_at) continue; // waiting on a person, not on the network
    try {
      await apiFetch<ServerItem>(
        `/api/job-inventory/${encodeURIComponent(op.jobUuid)}/items`,
        { method: "POST", body: JSON.stringify({ ...op.payload, item_uuid: op.id }) },
      );
      removeOp(op.id);
    } catch (e) {
      if (isPermanentRejection(e)) {
        patch(op.id, failureMark(e, FIELD_LABELS));
      } else {
        return;
      }
    }
  }
}

// Drain queued adds for one job. `onResolved` fires per successful POST so the
// caller can swap tempId → server id. `onFailed` fires on a permanent 4xx so the
// caller can render the row as "not sent" with the reason. Network / 5xx / auth
// errors leave the op queued for the next pass (an expired token is transient;
// dropping would lose field work).
//
// The op is NOT removed on a permanent 4xx (ADR 0013). It stays in the queue,
// marked, and leaves only when the crew member retries it or discards it.
export async function drain(
  jobUuid: string,
  onResolved: (tempId: number, server: ServerItem) => void,
  onFailed: (tempId: number, reason: string) => void,
): Promise<void> {
  if (!navigator.onLine) return;
  const q = pendingFor(jobUuid);
  for (const op of q) {
    if (op.failed_at) continue; // waiting on a person, not on the network
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
      if (isPermanentRejection(e)) {
        const mark = failureMark(e, FIELD_LABELS);
        patch(op.id, mark);
        onFailed(op.tempId, mark.failed_reason);
      } else {
        return;
      }
    }
  }
}
