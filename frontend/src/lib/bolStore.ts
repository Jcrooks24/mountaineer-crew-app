/**
 * BOL store - offline-capable Digital Bill of Lading draft + submit queue.
 *
 * Model (deliberately simpler than the per-op materials queue): a BOL is ONE
 * document per job, built in a single field session, so we persist the whole
 * draft and submit it as an idempotent upsert keyed by bol_id.
 *
 *   - Draft: the working BOL (job autofill + inventory items) is autosaved to
 *     localStorage under DRAFT_PREFIX + job_uuid, so nothing is lost if the app
 *     is backgrounded or reloaded mid-build (offline-first invariant).
 *   - Submit queue: on Save, the current draft is enqueued as an upsert under
 *     QUEUE_KEY (keyed by bol_id - a re-save replaces the queued payload rather
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
 * job_uuid as) the job the crew already selected - no separate job picker, and
 * admin sees one job_uuid across Events / Materials / BOL.
 */

import { apiFetch, ApiError } from "../api/client";
import { CLEARED_FAILURE, failureMark, isPermanentRejection, type MaybeFailed } from "./queueFailure";
import { getToken } from "../auth/token";
import { addPhoto, updatePhoto, listPhotosForJob } from "./photoStore";
import { slotToBlob, toQueuedPhoto } from "./queuedPhoto";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

/** Thrown when a BOL signature/queue write can't be persisted (localStorage
 * quota exceeded / disabled). The form catches it to tell the crew to free up
 * space, instead of the old silent no-op behind a "signed" success (bug 5). */
export class BolStorageFullError extends Error {
  constructor() {
    super("This device's storage is full, so the signed BOL could not be saved. Free up space and sign again.");
    this.name = "BolStorageFullError";
  }
}

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
  /** Only meaningful when the item is a box (name contains "box"). "cp" =
   * Company Packed, "pbo" = Packed By Owner. "" = not yet indicated. FMCSA
   * loss-and-damage liability differs between the two so this belongs on
   * the BOL, not in condition notes. */
  packed_by?: "cp" | "pbo" | "";
};

/** True when an item name should surface the CP/PBO selector. Matches
 * anything with "box" in the name so both furniture-catalog entries
 * ("Medium box", "Wardrobe box") and free-form entries ("Box of books")
 * get the picker. */
export function itemIsBox(name: string | undefined | null): boolean {
  return /\bbox(es)?\b/i.test(String(name || ""));
}

export type BOLStatus = "draft" | "origin_signed" | "delivered";

export type BOLDraft = {
  bol_id: string;
  job_uuid: string;
  job_name: string;
  job_date: string;
  status: BOLStatus;
  items: BOLItem[];
  updated_at: string;       // ISO
  // Crew rep (informational; server records the authenticated user).
  crew_rep?: string;
  // ── Signing (Push 2) - base64 PNG data URLs kept in the local draft so the
  // PDF can be (re)generated on-device, even offline. ──
  origin_shipper_sig?: string;
  origin_carrier_sig?: string;
  origin_signed_at?: string;
  actual_pickup_date?: string;
  vehicle?: string;
  // Pickup + delivery addresses, printed ON the BOL. A DOT officer at a border
  // crossing needs these (they are not derivable from the job name). Captured at
  // origin signing, editable afterwards, and rendered on the PDF.
  origin_address?: string;
  dest_address?: string;
  // ── FMCSA 49 CFR 375.505 required BOL fields (crew-entered, not from an
  // estimate the crew cannot see - ADR 0023). All ride shipment_json, no
  // migration. See bolContract.ts for the option/label maps. ──
  shipper_name?: string;          // 375.505(b)(3)
  shipper_phone?: string;         // 375.505(b)(3)
  shipper_address?: string;       // 375.505(b)(3) - shipper's own address
  shipment_number?: string;       // 375.505(b)(16) - our shipment/job reference
  form_of_payment?: string;       // 375.505(b)(4) - option value (see FORM_OF_PAYMENT_OPTIONS)
  estimate_type?: string;         // 375.505(b)(15) - "binding" | "non_binding"
  valuation?: string;             // 375.505(b)(12) - "full_value" | "released"
  agreed_pickup?: string;         // 375.505(b)(6) - agreed pickup date or window
  agreed_delivery?: string;       // 375.505(b)(6) - agreed delivery date or window
  // COD-only (375.505(b)(5),(11)); shown only when form_of_payment == "cod".
  cod_notify?: string;
  cod_max?: string;
  // Conditional declarations, default "None"/"N/A" (375.505(b)(2),(13),(14)).
  additional_carriers?: string;
  third_party_insurance?: string;
  accessorial_services?: string;
  dest_shipper_sig?: string;
  dest_carrier_sig?: string;
  dest_signed_at?: string;
  origin_shipper_name?: string;
  dest_shipper_name?: string;
  walkthrough_notes?: string;
  final_charges?: number | null;
  signed_pdf_url?: string;
  // Crew inventory attestation (Inventory tab). undefined = untouched;
  // true = complete record; false = incomplete with an inventory_note.
  inventory_verified?: boolean;
  inventory_note?: string;
};

export type SignInput = {
  phase: "origin" | "destination";
  shipper_sig: string;
  carrier_sig: string;
  shipper_name?: string;
  signed_at: string;
  actual_pickup_date?: string;
  vehicle?: string;
  origin_address?: string;
  dest_address?: string;
  walkthrough_notes?: string;
  final_charges?: number | null;
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

/** Resize/compress before upload. Always resolves - falls back to the original
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

/** Persist the draft. Returns false on failure (quota exceeded / storage
 * disabled) so a caller holding a signature that MUST NOT be silently dropped
 * can surface it instead of reporting a false success (bug 5). */
export function saveDraft(d: BOLDraft): boolean {
  try {
    localStorage.setItem(draftKey(d.job_uuid), JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

/** Delete a job's BOL draft. Called once the BOL is fully on the server (a
 * delivered BOL with no remaining queue ops) so a season of signed drafts -
 * each up to ~4 base64 signature PNGs - doesn't fill localStorage. */
export function removeDraft(jobUuid: string): void {
  try {
    localStorage.removeItem(draftKey(jobUuid));
  } catch {
    /* storage unavailable - nothing to remove */
  }
}

/**
 * The BOL id for a job, derived DETERMINISTICALLY from job_uuid.
 *
 * It used to be `newUUID()` - a fresh random id per device. Two crew opening the
 * BOL for the same job therefore minted two different ids and produced two server
 * rows that never merged, so neither saw the other's items. That is the root of
 * "BOL does not sync across devices". Deriving the id from job_uuid means both
 * devices compute the SAME id and upsert the SAME row - one document per job,
 * exactly as job identity already works everywhere else (calEventToJobUuid).
 *
 * A truly job-less BOL (no job_uuid) falls back to random: there is nothing to
 * converge on, so per-device is the best available.
 */
export function bolIdForJob(job_uuid: string): string {
  const j = (job_uuid || "").trim();
  if (!j) return newUUID();
  const fnv = (s: string): number => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const parts = [fnv(j), fnv(j + "\x01"), fnv(j + "\x02"), fnv(j + "\x03")];
  return "bol-" + parts.map((n) => n.toString(16).padStart(8, "0")).join("");
}

export function newDraft(job: { job_uuid: string; job_name: string; job_date: string }): BOLDraft {
  return {
    bol_id: bolIdForJob(job.job_uuid),
    job_uuid: job.job_uuid || "",
    job_name: job.job_name || "",
    job_date: job.job_date || "",
    status: "draft",
    items: [],
    updated_at: new Date().toISOString(),
  };
}

// ── Job selection (mirrors the Timeline tab) ──────────────────────────────────

export type CalEvent = { id: string; summary: string; start?: string; end?: string };

/** Deterministic UUID from a Google Calendar event id - identical to the
 * Timeline's calEventToJobUuid so a job selected here shares the same job_uuid
 * as clock-in events, materials, photos, etc. */
export function calEventToJobUuid(calId: string): string {
  const fnv = (s: string, seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const a = fnv(calId, 2166136261);
  const b = fnv(calId + "\x00", 2166136261);
  const c = fnv(calId + "\x01", 2166136261);
  const d = fnv(calId + "\x02", 2166136261);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Deterministic UUID for a manually-typed job name on a given date -
 * mirrors the Timeline tab's manualJobToJobUuid so a PODS / BOL / event
 * logged against the same (name, date) pair lands on the same job_uuid.
 * Normalization collapses whitespace and case to keep " The Smith Job "
 * and "the smith job" on one UUID. */
export function manualJobToJobUuid(name: string, date: string): string {
  const normalized = (name || "").trim().replace(/\s+/g, " ").toLowerCase();
  return calEventToJobUuid(`manual:${date}:${normalized}`);
}

/** Fetch the manual jobs registered for a date across devices, so a name
 * typed on the Timeline appears in the PODS / BOL job pickers too. */
export async function fetchManualJobsForDate(date: string): Promise<{ job_uuid: string; name: string }[]> {
  if (!navigator.onLine) return [];
  try {
    const token = getToken();
    const res = await fetch(`${API}/api/jobs/manual?date=${encodeURIComponent(date)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const json = await res.json();
    const entries = json?.entries;
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/** Resolve a calendar event to its canonical job_uuid (server), falling back to
 * the deterministic local hash offline - same as the Timeline. */
export async function resolveJobUuid(
  calId: string,
  scheduledStart?: string,
  scheduledEnd?: string,
): Promise<string> {
  if (navigator.onLine) {
    try {
      const token = getToken();
      // Pass the scheduled window so the server caches it on the job for the
      // est-vs-actual scheduled-duration fallback.
      let url = `${API}/api/jobs/resolve?calendar_event_id=${encodeURIComponent(calId)}`;
      if (scheduledStart) url += `&scheduled_start=${encodeURIComponent(scheduledStart)}`;
      if (scheduledEnd) url += `&scheduled_end=${encodeURIComponent(scheduledEnd)}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.job_uuid) return j.job_uuid;
      }
    } catch {
      /* fall through */
    }
  }
  return calEventToJobUuid(calId);
}

/** Fetch the day's calendar jobs (same endpoint the Timeline uses). */
export async function fetchCalendarDay(date: string): Promise<CalEvent[]> {
  if (!navigator.onLine) return [];
  const token = getToken();
  const res = await fetch(`${API}/api/calendar/day?date=${encodeURIComponent(date)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok !== true) throw new Error(json?.detail || `Calendar HTTP ${res.status}`);
  return (json.events || []).map((e: any) => ({
    id: String(e.id),
    summary: String(e.summary || e.title || "Untitled job"),
    start: e.start ? String(e.start) : undefined,
    end: e.end ? String(e.end) : undefined,
  }));
}

/** Persist a selected job's name/date so it resolves consistently (shares the
 * Timeline's per-uuid keys). Does not change the Timeline's active job. */
export function rememberJob(job: { job_uuid: string; job_name: string; job_date: string }): void {
  if (!job.job_uuid) return;
  try {
    localStorage.setItem(JOB_NAME_PREFIX + job.job_uuid, job.job_name || "");
    localStorage.setItem(JOB_DATE_PREFIX + job.job_uuid, job.job_date || "");
    localStorage.setItem(
      JOB_META_PREFIX + job.job_uuid,
      JSON.stringify({ job_uuid: job.job_uuid, jobName: job.job_name, jobDate: job.job_date, source: "bol", updated_at: new Date().toISOString() }),
    );
  } catch {}
}

// ── Open-BOL chooser ──────────────────────────────────────────────────────────

export type OpenBol = {
  bol_id: string;
  job_uuid: string;
  job_name: string;
  job_date: string;
  status: BOLStatus;
  updated_at: string;
  source: "server" | "local";
};

/** List BOLs that are still open (not delivered) for the "continue a BOL"
 * chooser - server BOLs merged with any local drafts, newest first. */
export async function listOpenBols(): Promise<OpenBol[]> {
  const map = new Map<string, OpenBol>();
  // Local drafts (covers offline-built BOLs not yet synced).
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      const d = JSON.parse(localStorage.getItem(k) || "null") as BOLDraft | null;
      if (!d || !d.bol_id || d.status === "delivered") continue;
      map.set(d.bol_id, {
        bol_id: d.bol_id, job_uuid: d.job_uuid, job_name: d.job_name, job_date: d.job_date,
        status: d.status, updated_at: d.updated_at, source: "local",
      });
    }
  } catch {}
  // Server BOLs (authoritative - overrides a local dup by bol_id).
  if (navigator.onLine) {
    try {
      const r = await apiFetch<{ ok: boolean; bols: any[] }>(`/api/bol?limit=100`);
      for (const b of r.bols || []) {
        const status = (b.status as BOLStatus) || "draft";
        if (status === "delivered") continue;
        const id = b.bol_id || b.id;
        map.set(id, {
          bol_id: id, job_uuid: b.job_uuid || "", job_name: b.job_name || "", job_date: b.job_date || "",
          status, updated_at: b.updated_at || "", source: "server",
        });
      }
    } catch {}
  }
  return [...map.values()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// ── Cross-rep / cross-device loading ──────────────────────────────────────────

function normalizeServerItem(it: any, i: number): BOLItem {
  const rawPackedBy = String(it.packed_by ?? "").toLowerCase();
  const packed_by: BOLItem["packed_by"] =
    rawPackedBy === "cp" || rawPackedBy === "pbo" ? rawPackedBy : "";
  return {
    item_no: typeof it.item_no === "number" ? it.item_no : i + 1,
    id: String(it.id ?? newUUID()),
    name: String(it.name ?? ""),
    qty: Math.max(1, Math.floor(Number(it.qty) || 1)),
    condition_notes: String(it.condition_notes ?? ""),
    photos: Array.isArray(it.photos) ? it.photos : [],
    packed_by,
  };
}

function draftFromServer(s: any, job: { job_uuid: string; job_name: string; job_date: string }, crewRep?: string): BOLDraft {
  const shipment = s.shipment || {};
  return {
    bol_id: s.bol_id || s.id,
    job_uuid: s.job_uuid || job.job_uuid || "",
    job_name: s.job_name || job.job_name || "",
    job_date: s.job_date || job.job_date || "",
    status: (s.status as BOLStatus) || "draft",
    items: Array.isArray(s.items) ? s.items.map(normalizeServerItem) : [],
    updated_at: s.updated_at || new Date().toISOString(),
    crew_rep: crewRep || s.created_by || "",
    origin_shipper_sig: s.origin_shipper_sig || undefined,
    origin_carrier_sig: s.origin_carrier_sig || undefined,
    origin_signed_at: s.origin_signed_at || undefined,
    origin_shipper_name: shipment.origin_shipper_name || undefined,
    actual_pickup_date: shipment.actual_pickup_date || undefined,
    vehicle: shipment.vehicle || undefined,
    origin_address: shipment.origin_address || undefined,
    dest_address: shipment.dest_address || undefined,
    shipper_name: shipment.shipper_name || undefined,
    shipper_phone: shipment.shipper_phone || undefined,
    shipper_address: shipment.shipper_address || undefined,
    shipment_number: shipment.shipment_number || undefined,
    form_of_payment: shipment.form_of_payment || undefined,
    estimate_type: shipment.estimate_type || undefined,
    valuation: shipment.valuation || undefined,
    agreed_pickup: shipment.agreed_pickup || undefined,
    agreed_delivery: shipment.agreed_delivery || undefined,
    cod_notify: shipment.cod_notify || undefined,
    cod_max: shipment.cod_max || undefined,
    additional_carriers: shipment.additional_carriers || undefined,
    third_party_insurance: shipment.third_party_insurance || undefined,
    accessorial_services: shipment.accessorial_services || undefined,
    dest_shipper_sig: s.dest_shipper_sig || undefined,
    dest_carrier_sig: s.dest_carrier_sig || undefined,
    dest_signed_at: s.dest_signed_at || undefined,
    dest_shipper_name: shipment.dest_shipper_name || undefined,
    walkthrough_notes: s.walkthrough_notes || undefined,
    final_charges: s.final_charges ?? null,
    signed_pdf_url: s.signed_pdf_url || undefined,
    inventory_verified: typeof s.inventory_verified === "boolean" ? s.inventory_verified : undefined,
    inventory_note: s.inventory_note || undefined,
  };
}

/** Fetch the newest server BOL for a job (server orders newest-first). */
export async function fetchRemoteBol(jobUuid: string): Promise<any | null> {
  if (!jobUuid || !navigator.onLine) return null;
  try {
    const r = await apiFetch<{ ok: boolean; bols: any[] }>(`/api/bol?job_uuid=${encodeURIComponent(jobUuid)}`);
    const bols = r.bols || [];
    return bols.length ? bols[0] : null;
  } catch {
    return null;
  }
}

function queueHasOpsForBol(bolId: string): boolean {
  return loadQueue().some((o) => o.bol_id === bolId);
}

/** What `loadForJobWithInfo` returns: the resolved draft, plus whether a BOL
 * ALREADY existed for this job (so the caller can warn the crew that they are
 * continuing one document, not creating a second - there is one BOL per job). */
export type LoadForJobResult = {
  draft: BOLDraft;
  /** A BOL already exists for this job (on the server, or a local draft that
   * already has items / has been signed). A fresh, empty draft is `false`. */
  existed: boolean;
  itemCount: number;
  signed: boolean;
};

/** Bridge: the crew logs actual inventory in the Inventory tab, which writes to
 * `job_inventory_items` (keyed by job_uuid) - a store the BOL never read. On a
 * non-loading LD leg the BOL-inventory tab is hidden, so the crew's only
 * inventory option was that separate store, and they ended up signing a BOL
 * with no items. This pulls the job's Actual Inventory into the BOL as its
 * declared items, mapped to the BOL item shape. Item ids are prefixed `inv-` +
 * the item's uuid/id so a re-open (or the two-device merge) dedupes instead of
 * duplicating. Best-effort + online-only: a failure or offline just returns []
 * and the BOL is unchanged. Amends ADR 0015's strict separation - see ADR
 * 0030. */
// One seed attempt per BOL per session. loadForJob re-runs on every tab
// focus / visibilitychange, so without this an empty BOL would re-fetch
// inventory on every refocus, and items the crew deliberately deleted would
// keep reappearing. Seeding once per session leaves the crew in control after
// the first fill. Cleared on reload (a Set, not persisted), so a genuinely new
// session re-checks.
const _seedAttempted = new Set<string>();

async function seedItemsFromInventory(jobUuid: string): Promise<BOLItem[]> {
  if (!jobUuid || !navigator.onLine) return [];
  try {
    const r = await apiFetch<{ items: Array<Record<string, any>> }>(
      `/api/job-inventory/${encodeURIComponent(jobUuid)}`,
    );
    const rows = Array.isArray(r.items) ? r.items : [];
    return rows.map((it, i) => {
      const room = (it.room || "").trim();
      const notes = (it.notes || "").trim();
      const pt = String(it.pack_type || "").toUpperCase();
      return {
        item_no: i + 1,
        id: `inv-${it.item_uuid || it.id}`,
        name: it.name || "",
        qty: Math.max(1, Number(it.qty) || 1),
        condition_notes: room ? (notes ? `${room}: ${notes}` : room) : notes,
        photos: [],
        packed_by: pt === "CP" ? "cp" : pt === "PBO" ? "pbo" : "",
      } as BOLItem;
    });
  } catch {
    return [];
  }
}

/** Resolve the working draft for a job: adopt the server BOL as the source of
 * truth (so any rep/device can continue a job's BOL at any stage, with the
 * earlier signatures intact) UNLESS there is unsynced local work, or the local
 * draft is newer than the server (autosaved edits not yet pushed).
 *
 * Also reports whether a BOL already existed for the job. A job has exactly ONE
 * BOL (id derived from job_uuid), so a crew who picks the same job again is
 * continuing the existing document, not making a new one - the caller uses
 * `existed` to make that explicit and stop an accidental self-overwrite. */
export async function loadForJobWithInfo(job: { job_uuid: string; job_name: string; job_date: string }): Promise<LoadForJobResult> {
  const local = loadDraft(job.job_uuid);
  const pendingLocal = local ? queueHasOpsForBol(local.bol_id) : false;
  const server = await fetchRemoteBol(job.job_uuid);

  // A local draft "counts" as an existing BOL only if it holds real work
  // (items or a signature) - an empty autosaved shell is not something the crew
  // needs warning about overwriting.
  const localHasWork = !!local && (local.items.length > 0 || local.status !== "draft");

  let draft: BOLDraft;
  let existed: boolean;
  // Persist only what the pre-bridge code persisted (an adopted/merged server
  // draft), plus a draft the seed actually populated. A bare newDraft in the
  // no-server path is left UNSAVED, exactly as before - otherwise merely opening
  // a BOL would persist an empty draft that then shows as a blank entry in the
  // open-BOL chooser (listOpenBols enumerates local drafts).
  let shouldPersist = false;
  if (!server) {
    draft = local || newDraft(job);
    existed = localHasWork;
  } else {
    const serverDraft = draftFromServer(server, job, local?.crew_rep);
    if (!local || !pendingLocal) {
      // No un-synced local edits: the local draft is fully synced, so the SERVER
      // is authoritative and is adopted unconditionally. This replaces a string
      // compare of `updated_at` that let a device's own edits permanently block
      // adoption - the reason a second device never saw the first's items.
      draft = serverDraft;
    } else {
      // Un-synced local edits exist AND the server has a copy. Because the id is
      // now derived from job_uuid, both refer to the same document, so union the
      // item lists by item id rather than pick a winner - a second device
      // building the same BOL must not drop the first device's items. Local wins
      // a per-item conflict (it holds the edit that hasn't been pushed yet).
      // Signatures/status stay local while a signing op is queued, else server.
      draft = mergeBolDrafts(local, serverDraft);
    }
    // A server BOL exists, so the crew is continuing an existing document.
    existed = true;
    shouldPersist = true; // prior behavior saved the adopted/merged server draft
  }

  // Bridge (ADR 0030): an UNSIGNED BOL with no items of its own inherits the
  // job's Actual Inventory, so inventory logged in the Inventory tab shows on
  // the BOL instead of the crew signing an empty one. Gated on status "draft"
  // so a signed BOL is never re-seeded, and on an empty item list so crew-added
  // BOL items are never duplicated. Best-effort: offline / no inventory / a
  // fetch error just leaves the draft untouched. `existed` is computed BEFORE
  // the seed: seeding inventory into a fresh BOL does not make it a pre-existing
  // document, so the self-overwrite warning still keys off a real prior BOL.
  if (draft.items.length === 0 && draft.status === "draft" && !_seedAttempted.has(draft.bol_id)) {
    _seedAttempted.add(draft.bol_id); // once per BOL per session, whatever the result
    const seeded = await seedItemsFromInventory(job.job_uuid);
    if (seeded.length) {
      draft = { ...draft, items: seeded, updated_at: new Date().toISOString() };
      shouldPersist = true; // a populated draft is worth persisting; a blank one is not
    }
  }

  if (shouldPersist) saveDraft(draft);
  return { draft, existed, itemCount: draft.items.length, signed: draft.status !== "draft" };
}

/** Thin wrapper: the resolved draft only (callers that don't need the
 * existed/warn signal - e.g. reopening a BOL the crew explicitly picked). */
export async function loadForJob(job: { job_uuid: string; job_name: string; job_date: string }): Promise<BOLDraft> {
  return (await loadForJobWithInfo(job)).draft;
}

/** Union two drafts' items by item id (local wins per-item), preserving both
 * devices' additions. NOT a deletion-aware merge: an item deleted on one device
 * while the other still holds it will reappear. Concurrent editing of the SAME
 * BOL on two devices is rare and this is the safe-for-data direction (keep, don't
 * lose); a true delete is honored once there are no competing local edits and the
 * server copy is adopted wholesale above. */
function mergeBolDrafts(local: BOLDraft, server: BOLDraft): BOLDraft {
  const byId = new Map<string, BOLItem>();
  for (const it of server.items) byId.set(it.id, it);
  for (const it of local.items) byId.set(it.id, it); // local wins
  const items = [...byId.values()].sort((a, b) => a.item_no - b.item_no);
  // Renumber item_no so the merged list is contiguous (two devices can both have
  // assigned e.g. item_no 3).
  items.forEach((it, i) => { it.item_no = i + 1; });

  const signingQueued = loadQueue().some((o) => o.op === "sign" && o.bol_id === local.bol_id);
  const sigSource = signingQueued ? local : server;
  return {
    ...server,
    ...local,          // local scalar fields win (notes, verified, etc.)
    items,
    // Signature fields come as a set from whichever side owns the pending sign.
    origin_shipper_sig: sigSource.origin_shipper_sig,
    origin_carrier_sig: sigSource.origin_carrier_sig,
    origin_signed_at: sigSource.origin_signed_at,
    dest_shipper_sig: sigSource.dest_shipper_sig,
    dest_carrier_sig: sigSource.dest_carrier_sig,
    dest_signed_at: sigSource.dest_signed_at,
    status: sigSource.status,
    signed_pdf_url: sigSource.signed_pdf_url,
  };
}

// Debounced background push of the current draft's items to the server.
//
// Unlike save(), this does NOT require the completeness attestation - it just
// gets the item list to the server so a second device sees items as they are
// added, which is what "sync across devices" means to the crew. Signing stays a
// deliberate, gated step. The server upsert replaces items_json wholesale and the
// sheet export is replace-style, so a removed or edited item is reflected too.
let _autosyncTimer: ReturnType<typeof setTimeout> | null = null;
export function autosyncDraft(d: BOLDraft): void {
  enqueueSubmit(d); // persist the intent immediately (survives reload)
  if (_autosyncTimer) clearTimeout(_autosyncTimer);
  _autosyncTimer = setTimeout(() => { void syncQueue(); }, 1000);
}

// ── Submit queue (idempotent upsert by bol_id) ────────────────────────────────

const QUEUE_KEY = "crew_bol_queue_v1";

// Heterogeneous op queue: inventory upsert, a signing session, or a
// (re)generate-and-upload of the signed PDF. Drained in order on reconnect.
// `attempts` / `retry_at` back the transient-failure backoff (bug 6): a
// repeatedly-failing transient op (e.g. a Drive 502) is spaced out instead of
// re-fired on every mount/online/save. Both optional, so entries already on crew
// phones stay valid and a fresh enqueue (which omits them) resets the backoff.
type RetryMeta = { attempts?: number; retry_at?: string };

type QueueOp = (
  | { op: "submit"; bol_id: string; payload: Record<string, unknown> }
  | { op: "sign"; bol_id: string; payload: Record<string, unknown> }
  | { op: "pdf"; bol_id: string; job_uuid: string }
) & MaybeFailed & RetryMeta;

// Transient-retry backoff: gentle (a signed BOL should sync ASAP) but enough to
// stop hammering a down Drive/DB. 2s, 4s, 8s ... capped at 2 min.
const RETRY_BASE_MS = 2000;
const RETRY_CAP_MS = 120000;
function backoffMs(attempts: number): number {
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

function loadQueue(): QueueOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueOp[];
    if (!Array.isArray(parsed)) return [];
    // Back-compat: Push-1 entries had no `op` field (were plain submits).
    return parsed.map((o) => (o && (o as any).op ? o : ({ op: "submit", ...(o as any) } as QueueOp)));
  } catch {
    return [];
  }
}

function saveQueue(q: QueueOp[]): boolean {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    return true;
  } catch {
    return false;
  }
}

/** Only uploaded photos (with a drive_url) are sent to the server; pending ones
 * backfill on a later re-enqueue after retryPendingPhotos(). */
function draftToPayload(d: BOLDraft): Record<string, unknown> {
  // Echo the full known shipment so a plain submit / autosync carries the
  // addresses to the server (the sign PATCH is not the only path that sets
  // them - they can be edited on an already-signed BOL). The server replaces
  // shipment_json wholesale when `shipment` is present, so we include every
  // shipment field the draft holds - all of them round-trip via draftFromServer
  // - and omit `shipment` entirely when nothing is set, so an early autosync on
  // a fresh draft does not wipe a value the server already has.
  const shipment: Record<string, string> = {};
  if (d.origin_address) shipment.origin_address = d.origin_address;
  if (d.dest_address) shipment.dest_address = d.dest_address;
  if (d.actual_pickup_date) shipment.actual_pickup_date = d.actual_pickup_date;
  if (d.vehicle) shipment.vehicle = d.vehicle;
  if (d.origin_shipper_name) shipment.origin_shipper_name = d.origin_shipper_name;
  if (d.dest_shipper_name) shipment.dest_shipper_name = d.dest_shipper_name;
  // FMCSA required fields (ADR 0023). Truthy-only, so a blank does not clobber a
  // value the server already holds.
  if (d.shipper_name) shipment.shipper_name = d.shipper_name;
  if (d.shipper_phone) shipment.shipper_phone = d.shipper_phone;
  if (d.shipper_address) shipment.shipper_address = d.shipper_address;
  if (d.shipment_number) shipment.shipment_number = d.shipment_number;
  if (d.form_of_payment) shipment.form_of_payment = d.form_of_payment;
  if (d.estimate_type) shipment.estimate_type = d.estimate_type;
  if (d.valuation) shipment.valuation = d.valuation;
  if (d.agreed_pickup) shipment.agreed_pickup = d.agreed_pickup;
  if (d.agreed_delivery) shipment.agreed_delivery = d.agreed_delivery;
  if (d.cod_notify) shipment.cod_notify = d.cod_notify;
  if (d.cod_max) shipment.cod_max = d.cod_max;
  if (d.additional_carriers) shipment.additional_carriers = d.additional_carriers;
  if (d.third_party_insurance) shipment.third_party_insurance = d.third_party_insurance;
  if (d.accessorial_services) shipment.accessorial_services = d.accessorial_services;
  return {
    id: d.bol_id,
    created_at: d.updated_at,
    job_uuid: d.job_uuid,
    job_name: d.job_name,
    job_date: d.job_date,
    status: d.status,
    ...(Object.keys(shipment).length ? { shipment } : {}),
    items: d.items.map((it) => ({
      item_no: it.item_no,
      id: it.id,
      name: it.name,
      qty: it.qty,
      condition_notes: it.condition_notes,
      packed_by: it.packed_by || "",
      photos: it.photos
        .filter((p) => p.drive_url)
        .map((p) => ({ photo_id: p.photo_id, drive_url: p.drive_url, thumb_url: p.thumb_url, caption: p.caption || "" })),
    })),
    inventory_verified: d.inventory_verified ?? null,
    inventory_note: d.inventory_note || "",
  };
}

/** Queue the current draft as an upsert. A re-save replaces any queued SUBMIT
 * for the same bol_id (upsert - no point sending stale intermediate states);
 * queued sign/pdf ops are preserved.
 *
 * ORDER IS LOAD-BEARING. The submit must stay AHEAD of any sign/pdf for the same
 * bol_id, because the drain creates the row on submit and a sign/pdf against a
 * not-yet-created row 404s - which the ADR 0013 drain treats as a permanent
 * failure, marks the sign failed, and blocks the submit behind it: the signature
 * then never syncs. So a re-enqueue (from autosync or a photo backfill after the
 * BOL was already signed) must NOT push the submit to the back of the queue.
 * Replace it in place if one exists; otherwise insert it before the first
 * sign/pdf for this bol_id. */
export function enqueueSubmit(d: BOLDraft): boolean {
  const payload = draftToPayload(d);
  const q = loadQueue();
  const newOp: QueueOp = { op: "submit", bol_id: d.bol_id, payload };
  const at = q.findIndex((x) => x.op === "submit" && x.bol_id === d.bol_id);
  if (at >= 0) {
    q[at] = newOp; // in place: keeps its position ahead of this BOL's sign/pdf
  } else {
    const firstDep = q.findIndex(
      (x) => x.bol_id === d.bol_id && (x.op === "sign" || x.op === "pdf"),
    );
    if (firstDep >= 0) q.splice(firstDep, 0, newOp);
    else q.push(newOp);
  }
  return saveQueue(q);
}

/** Queue a signing session (origin/destination). Returns false if the queue
 * could not be persisted (quota) so the signature is never silently lost. */
function enqueueSign(bolId: string, payload: Record<string, unknown>): boolean {
  const q = loadQueue();
  q.push({ op: "sign", bol_id: bolId, payload });
  return saveQueue(q);
}

/** Queue a (re)generate-and-upload of the signed PDF. A later pdf op replaces
 * an earlier queued one for the same bol_id (only the latest state matters). */
function enqueuePdf(bolId: string, jobUuid: string): boolean {
  const q = loadQueue().filter((x) => !(x.op === "pdf" && x.bol_id === bolId));
  q.push({ op: "pdf", bol_id: bolId, job_uuid: jobUuid });
  return saveQueue(q);
}

/** Re-push an already-created BOL after a non-signature edit - specifically,
 * correcting the origin/destination address on a signed BOL. Queues the submit
 * (updates the row + sheet) and, once the BOL is past draft, a PDF regeneration
 * so the copy stored in Drive reflects the corrected addresses. Returns false if
 * the queue could not be persisted (quota). */
export function enqueueBolResync(d: BOLDraft): boolean {
  const okSubmit = enqueueSubmit(d);
  const okPdf = d.status === "draft" ? true : enqueuePdf(d.bol_id, d.job_uuid);
  return okSubmit && okPdf;
}

export function pendingSubmitCount(): number {
  return loadQueue().filter((o) => !o.failed_at).length;
}

/** Ops the server permanently refused, kept for the crew to retry (ADR 0013). */
export function failedBolOps(): QueueOp[] {
  return loadQueue().filter((o) => o.failed_at);
}

/** Clear the failed mark on every op for this BOL so the next drain retries the
 * whole submit->sign->pdf sequence in order. */
export function retryFailedBol(bolId: string): Promise<number> {
  saveQueue(loadQueue().map((o) => (o.bol_id === bolId ? { ...o, ...CLEARED_FAILURE } : o)));
  return syncQueue();
}

/** Discard the WHOLE op sequence for this BOL, not just the failed op. The ops
 * are order-coupled (submit->sign->pdf) and a failed submit holds its sign/pdf
 * behind it with no failed_at of their own; dropping only the failed op would
 * leave those siblings to run against a row that was never created, 404, and
 * resurrect the failed banner. So a discard removes every op for the bol_id. The
 * only path that drops signed work without reaching the server - confirm first. */
export function discardFailedBol(bolId: string): void {
  saveQueue(loadQueue().filter((o) => o.bol_id !== bolId));
}

/** Reject a `{ok:false}` body as a transient failure (status 0, so
 * isPermanentRejection keeps it queued for retry rather than marking it a
 * permanent rejection). Defense-in-depth against a BOL endpoint returning HTTP
 * 200 while signalling failure in the body. */
function assertOk(r: { ok?: boolean } | null | undefined): void {
  if (r && r.ok === false) {
    throw new ApiError(0, r);
  }
}

async function uploadBolPdfBlob(bolId: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", blob, "bol.pdf");
  const token = getToken() || "";
  const res = await fetch(`${API}/api/bol/${encodeURIComponent(bolId)}/pdf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new ApiError(res.status, json);
    throw err;
  }
}

/** Email the signed BOL PDF to the client. Sending mail needs connectivity
 * (unlike building / signing / presenting a BOL, which are offline-capable), so
 * this throws if offline - the caller surfaces a clear message rather than
 * pretending it sent. The PDF is generated on-device and posted with the
 * client's address; the server attaches it and sends via Postmark. */
export async function emailBolToClient(bolId: string, blob: Blob, toEmail: string): Promise<void> {
  if (!navigator.onLine) {
    throw new ApiError(0, { detail: "You are offline. Connect to the internet to email the client." });
  }
  const form = new FormData();
  form.append("to_email", toEmail);
  form.append("file", blob, "bol.pdf");
  const token = getToken() || "";
  const res = await fetch(`${API}/api/bol/${encodeURIComponent(bolId)}/email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new ApiError(res.status, json);
  }
}

// Guard against overlapping drains (online + mount can fire together).
let syncing = false;

/** Drain the op queue in order: inventory upserts, signing sessions, and PDF
 * (re)generation+upload. Transient failures (offline / 5xx / 408 / auth) stay
 * queued for retry.
 *
 * A permanent 4xx is MARKED FAILED and KEPT, never dropped (ADR 0013): these ops
 * carry customer and carrier signatures, and destroying one on a bad payload
 * loses a signature with no other copy. A failed op also BLOCKS the later ops for
 * the same bol_id (a sign must not run when the submit that should have created
 * the row was refused), so the sequence stays coherent until the crew retries it.
 * Returns how many ops were confirmed this run. */
export async function syncQueue(): Promise<number> {
  if (!navigator.onLine || syncing) return 0;
  syncing = true;
  // The session we started under. A logout / user switch can run synchronously
  // while this drain is awaiting the network; it wipes the queue (clearCrewState).
  // Writing our post-drain `remaining` back after that would RESURRECT the departed
  // user's ops for the next crew member on this device (wrong attribution). So we
  // persist only if the session is unchanged when we finish.
  const tokenAtStart = getToken();
  try {
    const q = loadQueue();
    if (q.length === 0) return 0;
    const remaining: QueueOp[] = [];
    let synced = 0;
    // bol_ids with an unsent op earlier in this pass. A later op for the same BOL
    // must wait behind it - the ops are ordered submit->sign->pdf and each
    // depends on the one before.
    const blocked = new Set<string>();
    // job_uuids of BOLs whose final (pdf) op drained this pass - candidates for
    // draft cleanup once we know nothing remains for their bol_id.
    const drainedPdf: Array<{ bol_id: string; job_uuid: string }> = [];
    const nowMs = Date.now();
    for (const op of q) {
      if (op.failed_at) { remaining.push(op); blocked.add(op.bol_id); continue; }
      if (blocked.has(op.bol_id)) { remaining.push(op); continue; }
      // Transient backoff: not yet due for retry - keep it and hold its sequence.
      if (op.retry_at && Date.parse(op.retry_at) > nowMs) {
        remaining.push(op); blocked.add(op.bol_id); continue;
      }
      try {
        if (op.op === "submit") {
          const r = await apiFetch<{ ok?: boolean }>("/api/bol", { method: "POST", body: JSON.stringify(op.payload) });
          // Defense-in-depth: the server now signals failure with a real 5xx
          // (see ADR 0020), but if any BOL endpoint ever regresses to a
          // 200-with-ok:false, treat it as a transient failure (keep + retry),
          // never a silent success that drops a signed BOL. apiFetch only throws
          // on !res.ok, so this body check is the belt to that suspenders.
          assertOk(r);
        } else if (op.op === "sign") {
          const r = await apiFetch<{ ok?: boolean }>(`/api/bol/${encodeURIComponent(op.bol_id)}/sign`, {
            method: "PATCH",
            body: JSON.stringify(op.payload),
          });
          assertOk(r);
        } else {
          // pdf: regenerate from the persisted draft, then upload. A missing/
          // mismatched draft is a genuine no-op (nothing to regenerate), not a
          // rejection, so it is acked rather than kept.
          const d = loadDraft(op.job_uuid);
          if (!d || d.bol_id !== op.bol_id) { synced++; continue; }
          const { generateBolPdf } = await import("./bolPdf");
          const blob = await generateBolPdf(d);
          await uploadBolPdfBlob(op.bol_id, blob);
          drainedPdf.push({ bol_id: op.bol_id, job_uuid: op.job_uuid });
        }
        synced++;
      } catch (e) {
        if (isPermanentRejection(e)) {
          remaining.push({ ...op, ...failureMark(e) });
        } else {
          // Transient: keep it, but back off so a persistently-down Drive/DB is
          // not re-hit on every mount/online/save (bug 6).
          const attempts = (op.attempts || 0) + 1;
          remaining.push({
            ...op,
            attempts,
            retry_at: new Date(nowMs + backoffMs(attempts)).toISOString(),
          });
        }
        // Either way this op did not land, so hold the rest of the sequence for
        // this BOL until the next pass.
        blocked.add(op.bol_id);
      }
    }
    // Skip the write-back (and draft cleanup) if the session changed while we
    // were draining - a logout wiped the queue and we must not re-create it for
    // the next user (vet M1).
    if (getToken() !== tokenAtStart) return synced;
    saveQueue(remaining);

    // Draft cleanup (bug 5): once a BOL's pdf op has drained and NOTHING remains
    // queued for its bol_id, the fully-signed document is on the server + Drive.
    // Drop the local draft (up to ~4 base64 signature PNGs) for a DELIVERED BOL
    // so completed jobs don't accumulate in localStorage over a season. A draft
    // that is not delivered, or still has queued ops, is left untouched.
    if (drainedPdf.length) {
      const stillQueued = new Set(remaining.map((o) => o.bol_id));
      for (const { bol_id, job_uuid } of drainedPdf) {
        if (stillQueued.has(bol_id)) continue;
        const d = loadDraft(job_uuid);
        if (d && d.bol_id === bol_id && d.status === "delivered") removeDraft(job_uuid);
      }
    }
    return synced;
  } finally {
    syncing = false;
  }
}

/** Apply a signing session to the draft: store the signatures/extras + advance
 * status, persist, and queue the sign PATCH + a PDF (re)generation. Returns the
 * updated draft. The caller separately generates the on-device PDF to hand the
 * client a copy at signing time (works offline). */
export function applySignature(draft: BOLDraft, input: SignInput): BOLDraft {
  const now = new Date().toISOString();
  let updated: BOLDraft;
  if (input.phase === "origin") {
    updated = {
      ...draft,
      origin_shipper_sig: input.shipper_sig,
      origin_carrier_sig: input.carrier_sig,
      origin_signed_at: input.signed_at,
      origin_shipper_name: input.shipper_name || draft.origin_shipper_name,
      actual_pickup_date: input.actual_pickup_date || draft.actual_pickup_date,
      vehicle: input.vehicle || draft.vehicle,
      origin_address: input.origin_address ?? draft.origin_address,
      dest_address: input.dest_address ?? draft.dest_address,
      status: "origin_signed",
      updated_at: now,
    };
  } else {
    updated = {
      ...draft,
      dest_shipper_sig: input.shipper_sig,
      dest_carrier_sig: input.carrier_sig,
      dest_signed_at: input.signed_at,
      dest_shipper_name: input.shipper_name || draft.dest_shipper_name,
      walkthrough_notes: input.walkthrough_notes ?? draft.walkthrough_notes,
      final_charges: input.final_charges ?? draft.final_charges,
      status: "delivered",
      updated_at: now,
    };
  }
  // Persist the signature-bearing draft FIRST and refuse to continue if storage
  // is full: a signature we cannot store must surface as an error, never a
  // silent no-op behind a success message (bug 5). QuotaExceededError is the
  // realistic failure here - each signed draft holds up to four base64 PNGs.
  if (!saveDraft(updated)) {
    throw new BolStorageFullError();
  }

  const signPayload: Record<string, unknown> = {
    phase: input.phase,
    shipper_sig: input.shipper_sig,
    carrier_sig: input.carrier_sig,
    shipper_name: input.shipper_name || "",
    signed_at: input.signed_at,
  };
  if (input.phase === "origin") {
    signPayload.actual_pickup_date = input.actual_pickup_date || "";
    signPayload.vehicle = input.vehicle || "";
    if (input.origin_address) signPayload.origin_address = input.origin_address;
    if (input.dest_address) signPayload.dest_address = input.dest_address;
  } else {
    signPayload.walkthrough_notes = input.walkthrough_notes || "";
    if (input.final_charges != null) signPayload.final_charges = input.final_charges;
  }
  // Make sure the latest inventory is on the server before the signature, then
  // queue the sign, then the PDF (regenerated from the now-signed draft). If any
  // enqueue can't persist (quota), surface it - a queued signature that never
  // made it to the queue is the exact silent loss this guards against.
  if (
    !enqueueSubmit(updated) ||
    !enqueueSign(updated.bol_id, signPayload) ||
    !enqueuePdf(updated.bol_id, updated.job_uuid)
  ) {
    throw new BolStorageFullError();
  }
  return updated;
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
  // No "folder" field - item photos land in the job's normal photo folder,
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
  const caption = `BOL item ${itemNo} - ${draft.job_name || "job"}`.slice(0, 120);
  const previewUrl = URL.createObjectURL(resized);

  // Persist offline-first so nothing is lost if the upload can't happen now.
  try {
    await addPhoto({
      id: photoId,
      job_uuid: draft.job_uuid || "none",
      created_at: new Date().toISOString(),
      mime: "image/jpeg",
      caption,
      // Bytes, not a Blob handle (ADR 0017).
      blob: await toQueuedPhoto(resized),
      drive_status: "pending",
    });
  } catch {
    // IndexedDB unavailable - we still try the upload below.
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
        // Throws if the photo's bytes are gone, rather than uploading an empty
        // body that the server would reject as a missing photo_id (ADR 0017).
        const source = await slotToBlob(s.blob);
        if (!source) throw new Error("Photo has no image data");
        const up = await uploadPhoto(p.photo_id, draft, source, s.caption || p.caption || "BOL item");
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
