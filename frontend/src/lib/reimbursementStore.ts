/**
 * Reimbursement store - offline-capable queue for mileage + expense submissions.
 *
 * Photo blobs are heavy so we use IndexedDB rather than localStorage. Queue
 * entries persist until the multipart POST to /api/reimbursements/* succeeds.
 *
 * Read side: server history is cached in localStorage. Page renders cache +
 * any pending-queue items (with status="pending") on top so the user always
 * sees their submission immediately, even before sync.
 */

import { apiFetch, ApiError } from "../api/client";
import { getToken } from "../auth/token";

// ── Types ────────────────────────────────────────────────────────────────────

export type ReimbursementType = "mileage" | "expense";
// "failed" is local-only: the server rejected the payload and the submission is
// sitting in the queue waiting for a person to look at it. It is never a server
// status. See the note on markFailed().
export type ReimbursementStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "pending"
  | "failed";

export type ReimbursementRow = {
  reimbursement_uuid: string;
  user_name: string;
  type: ReimbursementType;
  job_uuid: string | null;
  job_name: string | null;
  job_date: string | null;
  // Crew-entered date of the actual expense/trip (YYYY-MM-DD). Distinct from
  // created_at, which is when the submission was filed. Null on older rows.
  expense_date: string | null;
  odometer_start: number | null;
  odometer_end: number | null;
  odometer_start_photo_url: string | null;
  odometer_end_photo_url: string | null;
  amount: number | null;
  category: string | null;
  vendor: string | null;
  receipt_photo_url: string | null;
  payment_method: string | null;
  notes: string | null;
  status: ReimbursementStatus;
  approver_name: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  created_at: string;
  updated_at: string;
  // Only set on locally-failed rows (status "failed"). Why the server said no,
  // in language a crew member can act on.
  failed_reason?: string | null;
};

// Set on a queue entry when the server permanently rejects it. The entry stays in
// the queue: the crew member can see it failed, fix it, and retry. It is only ever
// removed by an explicit human action.
export type QueueFailure = {
  failed_at: string;
  failed_status: number;
  failed_reason: string;
};

// Every field below the uuid/type is optional - crew may submit a partial
// request and the admin follows up. null means "not provided".
export type MileageQueueEntry = {
  reimbursement_uuid: string;
  type: "mileage";
  odometer_start: number | null;
  odometer_end: number | null;
  job_uuid: string;
  job_name: string;
  job_date: string;
  expense_date: string;
  notes: string;
  odo_start_blob: Blob | null;
  odo_end_blob: Blob | null;
  created_at: string;
} & Partial<QueueFailure>;

export type PaymentMethod = "personal" | "company";

export type ExpenseQueueEntry = {
  reimbursement_uuid: string;
  type: "expense";
  amount: number | null;
  category: string;
  vendor: string;
  payment_method: PaymentMethod;
  job_uuid: string;
  job_name: string;
  job_date: string;
  expense_date: string;
  notes: string;
  receipt_blob: Blob | null;
  created_at: string;
} & Partial<QueueFailure>;

// Expense categories - fixed list so the form offers a dropdown rather than
// free text, keeping the Reimbursements sheet filterable for admin.
export const EXPENSE_CATEGORIES = [
  "Fuel",
  "Supplies / Materials",
  "Tolls & Parking",
  "Meals",
  "Equipment Rental",
  "Vehicle Maintenance",
  "Other",
] as const;

export type QueueEntry = MileageQueueEntry | ExpenseQueueEntry;

// ── Keys ─────────────────────────────────────────────────────────────────────

const DB_NAME = "crew_app_db";
// Shared crew_app_db version - MUST stay in sync with photoStore.ts. Both
// modules open the same database; IndexedDB rejects opening with a version
// below the current one, so both upgrade handlers create the full schema.
const DB_VERSION = 2;
const STORE_REIMBURSEMENTS = "reimbursement_queue";
const HISTORY_CACHE_KEY = "crew_reimbursement_history_cache_v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function newReimbursementUuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      // Both object stores are created here so this module can build the
      // full schema if it's the first to open crew_app_db. The "photos"
      // store is otherwise owned by photoStore.ts.
      if (!db.objectStoreNames.contains("photos")) {
        const store = db.createObjectStore("photos", { keyPath: "id" });
        store.createIndex("by_job", "job_uuid", { unique: false });
        store.createIndex("by_created", "created_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_REIMBURSEMENTS)) {
        const store = db.createObjectStore(STORE_REIMBURSEMENTS, {
          keyPath: "reimbursement_uuid",
        });
        store.createIndex("by_created", "created_at", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Queue ────────────────────────────────────────────────────────────────────

export async function enqueueMileage(entry: MileageQueueEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_REIMBURSEMENTS, "readwrite");
  tx.objectStore(STORE_REIMBURSEMENTS).put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function enqueueExpense(entry: ExpenseQueueEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_REIMBURSEMENTS, "readwrite");
  tx.objectStore(STORE_REIMBURSEMENTS).put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

export async function listPending(): Promise<QueueEntry[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_REIMBURSEMENTS, "readonly");
  const req = tx.objectStore(STORE_REIMBURSEMENTS).getAll();
  const results = (await txPromise<QueueEntry[]>(req)) || [];
  db.close();
  results.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return results;
}

async function removeFromQueue(uuid: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_REIMBURSEMENTS, "readwrite");
  tx.objectStore(STORE_REIMBURSEMENTS).delete(uuid);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

/** Read-modify-write a single queue entry, preserving its photo blobs. */
async function patchEntry(uuid: string, patch: Partial<QueueEntry>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_REIMBURSEMENTS, "readwrite");
  const store = tx.objectStore(STORE_REIMBURSEMENTS);
  const current = await txPromise<QueueEntry | undefined>(store.get(uuid));
  if (current) store.put({ ...current, ...patch } as QueueEntry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

/**
 * The server permanently rejected this submission (a 4xx that retrying cannot fix,
 * e.g. a payload it will never accept).
 *
 * This used to call removeFromQueue(), which deleted the crew member's submission
 * and logged a console.warn nobody would ever read. A rejected mileage claim is
 * field work with nowhere else to live: the odometer photos exist only on that
 * phone, and once the entry is gone it is gone. A payload bug on our side therefore
 * silently destroyed a person's expense claim.
 *
 * So we keep it. The entry stays in the queue, marked failed, and the crew member
 * sees it in their list with the reason and a Retry button. It leaves the queue only
 * when a human says so.
 */
async function markFailed(uuid: string, status: number, reason: string): Promise<void> {
  await patchEntry(uuid, {
    failed_at: new Date().toISOString(),
    failed_status: status,
    failed_reason: reason,
  } as Partial<QueueEntry>);
}

/** Clear the failed mark so the next drain picks the entry up again. */
export async function retryFailed(uuid: string): Promise<number> {
  await patchEntry(uuid, {
    failed_at: undefined,
    failed_status: undefined,
    failed_reason: undefined,
  } as Partial<QueueEntry>);
  return syncQueue();
}

/** Explicit, user-initiated delete of a failed submission. The only way one leaves
 *  the queue without reaching the server. */
export async function discardFailed(uuid: string): Promise<void> {
  await removeFromQueue(uuid);
}

/**
 * Turn an API error into something a crew member can act on. FastAPI's 422 body is
 * `{detail: [{loc: ["body","odometer_start"], msg: "..."}]}`, which is useless on a
 * phone, so name the field in the words the form uses.
 */
const FIELD_LABELS: Record<string, string> = {
  odometer_start: "Start odometer",
  odometer_end: "End odometer",
  amount: "Amount",
  category: "Category",
  vendor: "Vendor",
  payment_method: "Payment method",
  odometer_start_photo: "Start odometer photo",
  odometer_end_photo: "End odometer photo",
  receipt_photo: "Receipt photo",
  reimbursement_uuid: "Submission id",
};

function describeApiError(e: unknown): string {
  if (!(e instanceof ApiError)) {
    return e instanceof Error ? e.message : "Unknown error.";
  }
  const detail = (e.body as any)?.detail;
  if (Array.isArray(detail) && detail.length) {
    const parts = detail.map((d: any) => {
      const loc = Array.isArray(d?.loc) ? d.loc : [];
      const field = String(loc[loc.length - 1] ?? "");
      const label = FIELD_LABELS[field] || field || "A field";
      return `${label}: ${d?.msg || "was rejected"}`;
    });
    return parts.join(". ");
  }
  if (typeof detail === "string" && detail) return detail;
  return `The server rejected this submission (error ${e.status}).`;
}

// ── History (server view, cached for offline reads) ─────────────────────────

export function loadHistoryCache(): ReimbursementRow[] {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReimbursementRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistoryCache(rows: ReimbursementRow[]): void {
  try {
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(rows));
  } catch {}
}

export async function fetchHistory(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const rows = await apiFetch<ReimbursementRow[]>("/api/reimbursements");
    saveHistoryCache(rows);
    return true;
  } catch {
    return false;
  }
}

/** Render = queued entries (pending, or failed) prepended to server cache. */
export async function renderedRows(): Promise<ReimbursementRow[]> {
  const cache = loadHistoryCache();
  const pending = await listPending();
  const pendingAsRows: ReimbursementRow[] = pending.map((p) => {
    const queueStatus: ReimbursementStatus = p.failed_at ? "failed" : "pending";
    const failure = p.failed_reason ?? null;
    if (p.type === "mileage") {
      return {
        reimbursement_uuid: p.reimbursement_uuid,
        user_name: "",
        type: "mileage",
        job_uuid: p.job_uuid || null,
        job_name: p.job_name || null,
        job_date: p.job_date || null,
        expense_date: p.expense_date || null,
        odometer_start: p.odometer_start,
        odometer_end: p.odometer_end,
        odometer_start_photo_url: null,
        odometer_end_photo_url: null,
        amount: null,
        category: null,
        vendor: null,
        receipt_photo_url: null,
        payment_method: null,
        notes: p.notes || null,
        status: queueStatus,
        failed_reason: failure,
        approver_name: null,
        approved_at: null,
        approval_notes: null,
        created_at: p.created_at,
        updated_at: p.created_at,
      };
    }
    return {
      reimbursement_uuid: p.reimbursement_uuid,
      user_name: "",
      type: "expense",
      job_uuid: p.job_uuid || null,
      job_name: p.job_name || null,
      job_date: p.job_date || null,
      expense_date: p.expense_date || null,
      odometer_start: null,
      odometer_end: null,
      odometer_start_photo_url: null,
      odometer_end_photo_url: null,
      amount: p.amount,
      category: p.category || null,
      vendor: p.vendor || null,
      receipt_photo_url: null,
      payment_method: p.payment_method,
      notes: p.notes || null,
      status: queueStatus,
      failed_reason: failure,
      approver_name: null,
      approved_at: null,
      approval_notes: null,
      created_at: p.created_at,
      updated_at: p.created_at,
    };
  });

  // Filter out any cache rows for uuids still pending - we'd be showing the
  // local copy on top anyway.
  const pendingUuids = new Set(pendingAsRows.map((r) => r.reimbursement_uuid));
  const merged = [
    ...pendingAsRows,
    ...cache.filter((r) => !pendingUuids.has(r.reimbursement_uuid)),
  ];
  merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return merged;
}

// ── Sync ────────────────────────────────────────────────────────────────────

let syncing = false;

// Matches the constant used in api/client.ts. Inlined here because the JSON
// helper there auto-sets Content-Type and we need to let the browser pick the
// multipart/form-data boundary itself.
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

async function postMultipart(path: string, form: FormData): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    let body: any = null;
    try { body = await res.json(); } catch {}
    throw new ApiError(res.status, body);
  }
}

export async function syncQueue(): Promise<number> {
  if (!navigator.onLine) return 0;
  if (syncing) return 0;
  syncing = true;
  try {
    const pending = await listPending();
    if (pending.length === 0) return 0;
    let synced = 0;
    for (const entry of pending) {
      // A failed entry is waiting on a person, not on the network. Re-posting it on
      // every drain would just hammer the API with a payload we know it refuses.
      // retryFailed() clears the mark and puts it back in the rotation.
      if (entry.failed_at) continue;
      try {
        const form = new FormData();
        form.append("reimbursement_uuid", entry.reimbursement_uuid);
        form.append("job_uuid", entry.job_uuid || "");
        form.append("job_name", entry.job_name || "");
        form.append("job_date", entry.job_date || "");
        form.append("expense_date", entry.expense_date || "");
        form.append("notes", entry.notes || "");
        if (entry.type === "mileage") {
          // Only append fields the crew actually provided - the backend
          // treats every field as optional, so omitting a blank one keeps
          // it null rather than coercing "null"/"" into the record.
          if (entry.odometer_start != null) {
            form.append("odometer_start", String(entry.odometer_start));
          }
          if (entry.odometer_end != null) {
            form.append("odometer_end", String(entry.odometer_end));
          }
          if (entry.odo_start_blob) {
            form.append("odometer_start_photo", entry.odo_start_blob, "odo_start.jpg");
          }
          if (entry.odo_end_blob) {
            form.append("odometer_end_photo", entry.odo_end_blob, "odo_end.jpg");
          }
          await postMultipart("/api/reimbursements/mileage", form);
        } else {
          if (entry.amount != null) {
            form.append("amount", String(entry.amount));
          }
          form.append("category", entry.category || "");
          form.append("vendor", entry.vendor || "");
          form.append("payment_method", entry.payment_method);
          if (entry.receipt_blob) {
            form.append("receipt_photo", entry.receipt_blob, "receipt.jpg");
          }
          await postMultipart("/api/reimbursements/expense", form);
        }
        await removeFromQueue(entry.reimbursement_uuid);
        synced++;
      } catch (e) {
        // 401/403 are excluded - an expired token is transient; dropping the
        // op would silently lose a crew member's reimbursement submission.
        const isPermanent =
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 408 &&
          e.status !== 401 &&
          e.status !== 403;
        if (isPermanent) {
          // Rejected payload. Mark it, keep it, show it. Deleting it here would
          // destroy the crew member's submission and the photos attached to it,
          // which is exactly what this code used to do.
          await markFailed(
            entry.reimbursement_uuid,
            (e as ApiError).status,
            describeApiError(e),
          );
        }
        // Transient: leave in queue, retry next drain.
      }
    }
    return synced;
  } finally {
    syncing = false;
  }
}
