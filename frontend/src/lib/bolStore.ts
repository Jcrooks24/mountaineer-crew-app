/**
 * BOL store — offline-capable Digital Bill of Lading draft + submit queue.
 *
 * Model (deliberately simpler than the per-op materials queue): a BOL is ONE
 * document per job, built in a single field session, so we persist the whole
 * draft and submit it as an idempotent upsert keyed by bol_id.
 *
 *   - Draft: the working BOL (job autofill + inventory items) is autosaved to
 *     localStorage under DRAFT_PREFIX + job_uuid, so nothing is lost if the app
 *     is backgrounded or reloaded mid-build (offline-first invariant).
 *   - Submit queue: on Save, the current draft is enqueued as an upsert under
 *     QUEUE_KEY (keyed by bol_id — a re-save replaces the queued payload rather
 *     than stacking). syncQueue() POSTs each to /api/bol; the backend upserts,
 *     so retries never duplicate.
 *   - Photos: captured to IndexedDB (photoStore) first so an offline photo
 *     survives a reload, then uploaded to Drive via /api/photos/upload. The
 *     returned drive_url is stored on the item; retryPendingPhotos() finishes
 *     any that were captured offline once back online and re-enqueues the BOL
 *     so the Sheet links backfill.
 *
 * Job autofill: the main timeline persists the active job to these localStorage
 * keys; reading them here means the BOL is prefilled with (and shares the same
 * job_uuid as) the job the crew already selected — no separate job picker, and
 * admin sees one job_uuid across Events / Materials / BOL.
 */

import { apiFetch, ApiError } from "../api/client";
import { getToken } from "../auth/token";
import { addPhoto, updatePhoto, listPhotosForJob } from "./photoStore";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// ── Types ────────────────────────────────────────────────────────────────────

export type BOLPhoto = {
  photo_id: string;
  drive_url?: string;
  thumb_url?: string;
  caption?: string;
  /** True while the blob is only in IndexedDB (captured offline, not yet uploaded). */
  pending?: boolean;
};

export type BOLItem = {
  item_no: number;          // auto-assigned as built (1, 2, 3…)
  id: string;
  name: string;
  qty: number;
  condition_notes: string;
  photos: BOLPhoto[];
};

export type BOLStatus = "draft" | "origin_signed" | "delivered";

export type BOLDraft = {
  bol_id: string;
  job_uuid: string;
  job_name: string;
  job_date: string;
  status: BOLStatus;
  items: BOLItem[];
  updated_at: string;       // ISO
};

// ── Active-job autofill (written by the main timeline app) ────────────────────

const JOB_KEY = "crew_active_job_uuid_v1";
const JOB_NAME_PREFIX = "crew_job_name_v1:";
const JOB_DATE_PREFIX = "crew_job_date_v1:";
const JOB_META_PREFIX = "crew_job_meta_v1:";

export function readActiveJob(): { job_uuid: string; job_name: string; job_date: string } {
  try {
    const job_uuid = localStorage.getItem(JOB_KEY) || "";
    let job_name = "";
    let job_date = "";
    const metaRaw = job_uuid ? localStorage.getItem(JOB_META_PREFIX + job_uuid) : null;
    if (metaRaw) {
      const m = JSON.parse(metaRaw);
      job_name = m?.jobName || "";
      job_date = m?.jobDate || "";
    }
    if (!job_name && job_uuid) job_name = localStorage.getItem(JOB_NAME_PREFIX + job_uuid) || "";
    if (!job_date && job_uuid) job_date = localStorage.getItem(JOB_DATE_PREFIX + job_uuid) || "";
    return { job_uuid, job_name, job_date };
  } catch {
    return { job_uuid: "", job_name: "", job_date: "" };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function newUUID(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Resize/compress before upload. Always resolves — falls back to the original
 * on any failure. Copied from the estimator's proven implementation (the 30s
 * timer guards against a synchronous throw inside onload hanging forever). */
async function resizeImage(file: File | Blob, maxPx = 1920, quality = 0.8): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (out: Blob) => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
      resolve(out);
    };
    const timeout = window.setTimeout(() => finish(file), 30_000);
    img.onload = () => {
      window.clearTimeout(timeout);
      try {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(file); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => finish(blob ?? file), "image/jpeg", quality);
      } catch {
        finish(file);
      }
    };
    img.onerror = () => { window.clearTimeout(timeout); finish(file); };
    img.src = url;
  });
}

// ── Draft persistence (one active BOL per job) ────────────────────────────────

const DRAFT_PREFIX = "crew_bol_draft_v1:";

function draftKey(jobUuid: string): string {
  return `${DRAFT_PREFIX}${jobUuid || "none"}`;
}

export function loadDraft(jobUuid: string): BOLDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(jobUuid));
    if (!raw) return null;
    const d = JSON.parse(raw) as BOLDraft;
    if (!d || !Array.isArray(d.items)) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(d: BOLDraft): void {
  try {
    localStorage.setItem(draftKey(d.job_uuid), JSON.stringify(d));
  } catch {
    // Quota exceeded / disabled — ignore.
  }
}

export function newDraft(job: { job_uuid: string; job_name: string; job_date: string }): BOLDraft {
  return {
    bol_id: newUUID(),
    job_uuid: job.job_uuid || "",
    job_name: job.job_name || "",
    job_date: job.job_date || "",
    status: "draft",
    items: [],
    updated_at: new Date().toISOString(),
  };
}

// ── Submit queue (idempotent upsert by bol_id) ────────────────────────────────

const QUEUE_KEY = "crew_bol_queue_v1";

type QueuedBOL = { bol_id: string; payload: Record<string, unknown> };

function loadQueue(): QueuedBOL[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedBOL[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedBOL[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

/** Only uploaded photos (with a drive_url) are sent to the server; pending ones
 * backfill on a later re-enqueue after retryPendingPhotos(). */
function draftToPayload(d: BOLDraft): Record<string, unknown> {
  return {
    id: d.bol_id,
    created_at: d.updated_at,
    job_uuid: d.job_uuid,
    job_name: d.job_name,
    job_date: d.job_date,
    status: d.status,
    items: d.items.map((it) => ({
      item_no: it.item_no,
      id: it.id,
      name: it.name,
      qty: it.qty,
      condition_notes: it.condition_notes,
      photos: it.photos
        .filter((p) => p.drive_url)
        .map((p) => ({ photo_id: p.photo_id, drive_url: p.drive_url, thumb_url: p.thumb_url, caption: p.caption || "" })),
    })),
  };
}

/** Queue the current draft as an upsert. A re-save replaces any queued payload
 * for the same bol_id (upsert — no point sending stale intermediate states). */
export function enqueueSubmit(d: BOLDraft): void {
  const payload = draftToPayload(d);
  const q = loadQueue().filter((x) => x.bol_id !== d.bol_id);
  q.push({ bol_id: d.bol_id, payload });
  saveQueue(q);
}

export function pendingSubmitCount(): number {
  return loadQueue().length;
}

// Guard against overlapping drains (online + mount can fire together).
let syncing = false;

/** Drain the submit queue. Transient failures (offline / 5xx / 408 / auth) stay
 * queued for retry; permanent 4xx are dropped so one bad payload can't wedge
 * the queue. Returns how many were confirmed this run. */
export async function syncQueue(): Promise<number> {
  if (!navigator.onLine || syncing) return 0;
  syncing = true;
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueuedBOL[] = [];
    let synced = 0;
    for (const op of q) {
      try {
        await apiFetch("/api/bol", { method: "POST", body: JSON.stringify(op.payload) });
        synced++;
      } catch (e) {
        const isPermanent =
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 408 &&
          e.status !== 401 &&
          e.status !== 403;
        if (isPermanent) {
          console.warn(`[bol] dropping poison-pill submit (${op.bol_id}): ${e instanceof Error ? e.message : e}`);
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

// ── Photos ───────────────────────────────────────────────────────────────────

async function uploadPhoto(
  photoId: string,
  draft: BOLDraft,
  blob: Blob,
  caption: string,
): Promise<{ drive_url: string; thumb_url: string }> {
  const form = new FormData();
  form.append("file", blob, "bol.jpg");
  form.append("photo_id", photoId);
  form.append("job_uuid", draft.job_uuid || "");
  form.append("job_name", draft.job_name || "");
  form.append("job_date", draft.job_date || "");
  form.append("caption", caption);
  // No "folder" field — item photos land in the job's normal photo folder,
  // alongside the crew's other job photos (per the feature requirement).
  const token = getToken() || "";
  const res = await fetch(`${API}/api/photos/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return { drive_url: json.drive_url, thumb_url: json.thumb_url };
}

/** Capture a photo for an item: resize → persist to IndexedDB (survives reload)
 * → attempt immediate upload. Returns the BOLPhoto (with drive_url if the
 * upload succeeded, otherwise pending) and a session objectURL for preview. */
export async function captureItemPhoto(
  draft: BOLDraft,
  itemNo: number,
  file: File,
): Promise<{ photo: BOLPhoto; previewUrl: string }> {
  const photoId = newUUID();
  const resized = await resizeImage(file);
  const caption = `BOL item ${itemNo} — ${draft.job_name || "job"}`.slice(0, 120);
  const previewUrl = URL.createObjectURL(resized);

  // Persist offline-first so nothing is lost if the upload can't happen now.
  try {
    await addPhoto({
      id: photoId,
      job_uuid: draft.job_uuid || "none",
      created_at: new Date().toISOString(),
      mime: "image/jpeg",
      caption,
      blob: resized,
      drive_status: "pending",
    });
  } catch {
    // IndexedDB unavailable — we still try the upload below.
  }

  const photo: BOLPhoto = { photo_id: photoId, caption, pending: true };
  try {
    const up = await uploadPhoto(photoId, draft, resized, caption);
    photo.drive_url = up.drive_url;
    photo.thumb_url = up.thumb_url;
    photo.pending = false;
    try { await updatePhoto(photoId, { drive_status: "uploaded", drive_url: up.drive_url }); } catch {}
  } catch {
    // Stays pending in IndexedDB; retryPendingPhotos() will finish it.
  }
  return { photo, previewUrl };
}

/** Finish uploading any photos captured offline, patch their drive_urls into
 * the draft, and re-enqueue the BOL so the Sheet links backfill. Returns the
 * (possibly updated) draft. No-op when offline or nothing is pending. */
export async function retryPendingPhotos(draft: BOLDraft): Promise<BOLDraft> {
  if (!navigator.onLine) return draft;
  const hasPending = draft.items.some((it) => it.photos.some((p) => !p.drive_url));
  if (!hasPending) return draft;

  let stored: Awaited<ReturnType<typeof listPhotosForJob>> = [];
  try {
    stored = await listPhotosForJob(draft.job_uuid || "none");
  } catch {
    return draft;
  }
  const byId = new Map(stored.map((s) => [s.id, s]));

  let changed = false;
  const items: BOLItem[] = [];
  for (const it of draft.items) {
    const photos: BOLPhoto[] = [];
    for (const p of it.photos) {
      if (p.drive_url) { photos.push(p); continue; }
      const s = byId.get(p.photo_id);
      if (!s) { photos.push(p); continue; }
      try {
        const up = await uploadPhoto(p.photo_id, draft, s.blob, s.caption || p.caption || "BOL item");
        changed = true;
        try { await updatePhoto(p.photo_id, { drive_status: "uploaded", drive_url: up.drive_url }); } catch {}
        photos.push({ ...p, drive_url: up.drive_url, thumb_url: up.thumb_url, pending: false });
      } catch {
        photos.push(p);
      }
    }
    items.push({ ...it, photos });
  }

  if (!changed) return draft;
  const updated: BOLDraft = { ...draft, items, updated_at: new Date().toISOString() };
  saveDraft(updated);
  enqueueSubmit(updated);
  return updated;
}
