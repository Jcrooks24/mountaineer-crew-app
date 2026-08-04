import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { apiFetch } from "./api/client";
import JobReport from "./components/JobReport";
import BolInventoryTab from "./components/BolInventoryTab";
import ActualInventory from "./components/ActualInventory";
import IncidentReport, { type JobIncidentRef } from "./components/IncidentReport";
import { drainIncidents } from "./lib/incidentStore";
import { drainOffJob } from "./lib/offJobStore";
import { drainBugReports } from "./lib/bugReportStore";
import { drainFeatureRequests } from "./lib/featureRequestStore";
import { getUnitsCached as getVehUnitsCached, refreshUnits as refreshVehUnits, type VehicleUnit } from "./lib/vehicleUnits";
import { drainAll as drainJobInventory } from "./lib/jobInventoryQueue";
import { drainJobSetups } from "./lib/jobSetupStore";
import JobSetupPanel from "./components/JobSetupPanel";
import { drainChecklistChecks } from "./lib/jobChecklistStore";
import JobChecklistCard from "./components/JobChecklistCard";
import DqReminderBanner from "./components/DqReminderBanner";
import RodsRecorder from "./components/RodsRecorder";
import { useLdPlan } from "./components/LdWorkday";
import DVIRReminderModal from "./components/DVIRReminderModal";
import UserAvatar from "./components/UserAvatar";
import { ensureDirectory } from "./lib/userDirectory";
import { addPhoto, deletePhoto, listPhotosForJob, updatePhoto, type StoredPhoto } from "./lib/photoStore";
import { slotToBlob, slotToPreviewBlob, toQueuedPhoto, UnreadablePhotoError } from "./lib/queuedPhoto";
import { useTheme, useResolvedLogo } from "./theme/ThemeContext";
import {
  formatMountain,
  formatMountainDate,
  formatMountainDateTime,
  formatMountainTime,
  mountainDateYYYYMMDD,
} from "./lib/time";
import AdminNotesBanner from "./components/AdminNotesBanner";
import BetaTag from "./components/BetaTag";
import { getToken, clearToken } from "./auth/token";
import {
  syncQueue as syncMaterialsQueue,
  fetchAndCache as fetchAndCacheMaterials,
} from "./lib/materialsStore";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// Resize + compress a photo before upload so Render stays under its 512MB memory limit.
// Caps the longest side at 1920px and encodes as JPEG at 80% quality.
// Typical mobile photo: 8MB → ~600KB after this.
async function resizeImage(file: File | Blob, maxPx = 1920, quality = 0.8): Promise<Blob> {
  // Always resolves - never rejects, never hangs. Falls back to the original
  // file on any failure (decode error, OOM on canvas, unsupported MIME).
  // The 30s safety timer is the load-bearing piece: without it, an `onload`
  // that throws synchronously (e.g. `getContext("2d")` returns null on a
  // low-RAM phone) leaves the promise pending forever and the Save button
  // stuck on "Saving…".
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
    const timeout = window.setTimeout(() => {
      console.warn("[photo] resize timed out - uploading original");
      finish(file);
    }, 30_000);
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
      } catch (e) {
        console.warn("[photo] resize failed - uploading original", e);
        finish(file);
      }
    };
    img.onerror = () => { window.clearTimeout(timeout); finish(file); };
    img.src = url;
  });
}

// LocalStorage keys
const QUEUE_KEY = "crew_event_queue_v1"; // unsynced events only
const LOG_KEY = "crew_event_log_v1"; // full job activity log (synced + queued)
// Queue of per-event note edits the user made after the event already synced.
// Offline-safe: drains on online + inside syncQueueNow so notes eventually
// reach Postgres + the Events sheet.
const NOTE_PATCH_KEY = "crew_event_note_patch_queue_v1";

// Retention - the Google Sheet is the long-term record; the client log is a
// working buffer for the offline-first UX. Trim anything older than the
// retention window (and cap length as a hard ceiling) on boot so
// localStorage doesn't silently blow out its quota after months of use.
const LOG_RETENTION_DAYS = 14;
const LOG_MAX_ENTRIES = 2000;
const QUEUE_MAX_AGE_DAYS = 14; // unsynced ops this old are almost certainly dead

function withinRetention(iso: string | undefined, days: number): boolean {
  if (!iso) return true; // keep entries with no timestamp (defensive)
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t < days * 86_400_000;
}
const JOB_KEY = "crew_active_job_uuid_v1";
const JOB_STATUS_KEY = "crew_job_status_v1"; // "active" | "closed"
// Local vs long-distance mode - a device-global toggle (persists across
// restarts) that reshapes the Timeline + Report tabs for multi-day interstate
// jobs. Defaults to "local".
const MODE_KEY = "crew_mode_v1"; // "local" | "long_distance"
const COMMENTS_PREFIX = "crew_job_comments_v1:"; // per job_uuid

// Maps job_uuid → event_id of the JOB_NOTES sentinel event we created for it.
// Lets repeat edits PATCH the same row instead of creating a new event each save.
const JOB_NOTES_EVENT_PREFIX = "crew_job_notes_event_v1:"; // per job_uuid

// Per-job snapshot of the notes text that was last accepted into the sync
// pipeline. Compared against the live `jobComments` to decide whether the
// debounce should fire - survives across reloads and job switches so a save
// pending at the moment of switch eventually flushes when the user returns.
const NOTES_SYNCED_PREFIX = "crew_job_notes_synced_v1:"; // per job_uuid

// Per-job metadata (existing)
const JOB_NAME_PREFIX = "crew_job_name_v1:"; // per job_uuid
const JOB_DATE_PREFIX = "crew_job_date_v1:"; // per job_uuid

// NEW: job meta + calendar binding (fixes "events under wrong job name")
const JOB_META_PREFIX = "crew_job_meta_v1:"; // per job_uuid
const CAL_BIND_PREFIX = "crew_cal_bind_v1:"; // per date+calendarEventId => job_uuid

type Tab = "home" | "timeline" | "photos" | "report" | "inventory";

type EventRecord = {
  event_id: string;
  job_uuid: string;
  type: string;
  // User-editable event time. Drives chronological sort on the timeline.
  // Defaults to logged_at on capture; crew can correct it via the timeline UI.
  timestamp: string;
  // Immutable original device-capture time. Optional for backward-compat
  // with cached records written before this field existed (those rows
  // implicitly have logged_at == timestamp).
  logged_at?: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  note?: string | null;
  created_by?: string;
  sync_status: "queued" | "synced";
};

// Patch ops carry whichever fields the user changed. Either or both of
// `note` / `timestamp` may be present. Storage key keeps its historical
// "note_patch" name to preserve already-queued ops on devices upgrading
// in place - the shape is a strict superset.
type EventPatchOp = {
  event_id: string;
  note?: string | null;
  timestamp?: string;
  // Offline-safe delete: drained as a DELETE instead of a PATCH.
  deleted?: boolean;
  enqueued_at: string;
};

type CalEvent = {
  id: string;
  summary: string;
  start?: string;
  end?: string;
  // The office writes the job's address, crew, and special instructions into
  // the calendar event; surfaced in the hub's active-job context card so the
  // crew see what they're on. `description` can arrive as light HTML.
  description?: string;
  location?: string;
  // Count of invited crew on the event; cached server-side at resolve so the
  // est-vs-actual schedule fallback can express man-hours (invitees x duration).
  invitees?: number;
};

type JobMeta = {
  job_uuid: string;
  jobName: string;
  jobDate: string;
  source: "" | "manual" | "calendar";
  calendarEventId?: string;
  updated_at: string;
};

type ServerPhoto = {
  id: string;
  job_uuid: string;
  created_by: string;
  caption: string;
  drive_file_id: string;
  drive_url: string;
  thumb_url: string;
  created_at: string;
  mime_type: string;
  incident_uuid?: string | null;
  claim_number?: string | null;
};

// One entry in the pending photo batch (not yet saved). Crew can queue several
// - multi-selected from the library and/or taken one at a time - and add a
// per-photo note before submitting the whole batch.
type PendingPhoto = { id: string; file: File; caption: string };

// `<input type="time">` round-tripping. The element's value is "HH:mm" in
// the user's local time. We keep the event's existing date intact and only
// rewrite hours/minutes - crew typically just need to nudge minutes within
// a shift; a date change usually means the event is a much bigger mistake
// and should be re-logged.
function toTimeValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function applyTimeToIso(localTime: string, baseIso: string): string | null {
  if (!localTime) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const d = new Date(baseIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

// Returns null when valid, or a short reason when the user picked an
// unparseable time. Any real timestamp is allowed - crew can set event
// time to any time, past or future.
function validateEditableTimestamp(newIso: string, _loggedAtIso: string | undefined): string | null {
  const newT = Date.parse(newIso);
  if (!Number.isFinite(newT)) return "Invalid date.";
  return null;
}

// "Today" in Mountain time. Crew operate in Bozeman; an admin opening the
// app on a laptop in another timezone after midnight Mountain should still
// see Mountain's "today" as the default job date.
function todayLocalYYYYMMDD() {
  return mountainDateYYYYMMDD();
}

/**
 * Derive a deterministic UUID v4 from any string.
 * Same input always produces the same UUID across devices.
 */
function stringToJobUuid(seedStr: string): string {
  // FNV-1a 32-bit with different seeds to produce 128 bits total
  const fnv = (s: string, seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  };
  const a = fnv(seedStr, 2166136261);
  const b = fnv(seedStr + "\x00", 2166136261);
  const c = fnv(seedStr + "\x01", 2166136261);
  const d = fnv(seedStr + "\x02", 2166136261);
  const hex = [a, b, c, d].map((n) => n.toString(16).padStart(8, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Derive a deterministic UUID v4 from a Google Calendar event ID.
 * All devices calling this with the same calId get the same UUID.
 */
function calEventToJobUuid(calId: string): string {
  return stringToJobUuid(calId);
}

// Google Calendar descriptions can carry light HTML (<br>, <a>, bold). Strip to
// readable plain text for the active-job context card: tags out, common entities
// decoded, whitespace collapsed. Not a sanitizer - the result is rendered as
// TEXT, never as HTML.
function calText(raw: string | undefined | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Derive a deterministic UUID v4 for a manually-entered job. Any device
 * that types the same (normalized) name on the same date resolves to the
 * same job_uuid, so their events auto-merge without a round-trip to the
 * backend. Whitespace and case are collapsed to keep "The Smith Job" and
 * " The  Smith Job " on the same UUID.
 */
function manualJobToJobUuid(name: string, date: string): string {
  const normalized = (name || "").trim().replace(/\s+/g, " ").toLowerCase();
  return stringToJobUuid(`manual:${date}:${normalized}`);
}

// Manual entries persisted locally so they survive refresh (sessionStorage
// used to drop them). Keyed by jobDate; each entry is { id, summary, date }.
const MANUAL_ENTRIES_KEY = "crew_manual_entries_v1";
type ManualEntry = { id: string; summary: string; date: string };
function loadManualEntries(): ManualEntry[] {
  try {
    const arr = JSON.parse(localStorage.getItem(MANUAL_ENTRIES_KEY) || "[]");
    return Array.isArray(arr) ? arr.filter((e) => e && e.id && e.summary && e.date) : [];
  } catch {
    return [];
  }
}
function saveManualEntries(entries: ManualEntry[]) {
  try { localStorage.setItem(MANUAL_ENTRIES_KEY, JSON.stringify(entries)); } catch {}
}

/** Build a fetch-compatible headers object, adding Authorization if a token is present. */
function makeAuthHeaders(token: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function getDeviceId(): string {
  const KEY = "crew_device_id_v1";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

// Hub action-grid icons: 22px line icons, stroke = currentColor.
const _hi = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const HubIcons = {
  timeline: () => (<svg {..._hi}><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="20" cy="18" r="1.6" /></svg>),
  photos: () => (<svg {..._hi}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6l1.5-2h5L16 6" /><circle cx="12" cy="13" r="3.2" /></svg>),
  box: () => (<svg {..._hi}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>),
  report: () => (<svg {..._hi}><path d="M7 3h8l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 12h6M9 16h6M9 8h3" /></svg>),
  truck: () => (<svg {..._hi}><path d="M2 5h11v10H2z" /><path d="M13 8h4l4 4v3h-8z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>),
};

export default function App() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { settings: themeSettings } = useTheme();
  const { src: logo, variant: logoVariant } = useResolvedLogo();
  const ht = themeSettings.helpTexts;
  const [tab, setTab] = useState<Tab>("home");

  const [jobUuid, setJobUuid] = useState<string>(() => localStorage.getItem(JOB_KEY) || "");
  const [jobStatus, setJobStatus] = useState<"active" | "closed">(
    () => (localStorage.getItem(JOB_STATUS_KEY) as any) || "active"
  );

  const [mode, setMode] = useState<"local" | "long_distance">(
    () => (localStorage.getItem(MODE_KEY) as any) || "local"
  );
  const longDistance = mode === "long_distance";
  function setPersistedMode(val: "local" | "long_distance") {
    setMode(val);
    localStorage.setItem(MODE_KEY, val);
  }

  // The calendar event description is often long (the office pastes full
  // instructions), which crowds the hub. Collapsed by default; the crew expand
  // it when they need it.
  const [showJobDetails, setShowJobDetails] = useState(false);

  // The Inventory tab only exists in long-distance mode. Today the mode switch
  // itself lives on the Timeline tab, so nobody can be sitting on Inventory at
  // the moment it flips to local - but that is a layout coincidence, not a
  // guarantee. If the switch ever moves, the crew would land on a tab whose
  // button is gone and whose body renders nothing: a blank screen with no way
  // back. Cheap insurance.
  useEffect(() => {
    if (!longDistance && tab === "inventory") setTab("home");
  }, [longDistance, tab]);

  // Long-distance day plan - drives whether the timeline shows the labor Actions
  // buttons (packing/loading/unloading/unpacking) or the RODS recorder (driving).
  const {
    plan: ldPlan,
    driving: ldDriving,
    laborSelected: ldLabor,
    toggleActivity: ldToggleActivity,
  } = useLdPlan(todayLocalYYYYMMDD());

  const [status, setStatus] = useState<string>("");


  const [queueLen, setQueueLen] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<EventRecord[]>([]);

  const [clockText, setClockText] = useState<string>("-");
  // Retention prune on boot - drop stale log entries and stuck queue ops
  // so localStorage stays well clear of its per-origin quota. The Google
  // Sheet is authoritative long-term; this buffer only needs a couple of
  // weeks of history.
  useEffect(() => {
    try {
      const rawLog = localStorage.getItem(LOG_KEY);
      if (rawLog) {
        const log: EventRecord[] = JSON.parse(rawLog);
        const trimmed = log
          .filter((e) => withinRetention(e.timestamp, LOG_RETENTION_DAYS))
          .slice(0, LOG_MAX_ENTRIES);
        if (trimmed.length !== log.length) {
          localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
        }
      }
      const rawQ = localStorage.getItem(QUEUE_KEY);
      if (rawQ) {
        const q: EventRecord[] = JSON.parse(rawQ);
        const trimmedQ = q.filter((e) => withinRetention(e.timestamp, QUEUE_MAX_AGE_DAYS));
        if (trimmedQ.length !== q.length) {
          localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmedQ));
        }
      }
    } catch {
      /* corrupted JSON - ignore; next write will overwrite */
    }
  }, []);

  // Job metadata (display + persistence)
  const [jobName, setJobName] = useState<string>("");
  // Persist date within the browser session so navigating away and back
  // doesn't reset to today. sessionStorage clears on tab/browser close so
  // it still defaults to today on the first load of a new session.
  const [jobDate, setJobDate] = useState<string>(() =>
    sessionStorage.getItem("crew_session_jobDate") || todayLocalYYYYMMDD()
  );

  // Comments (per job_uuid)
  const [jobComments, setJobComments] = useState<string>("");

  // Sync status for the global Notes textarea. Drives the small status pill
  // shown next to the Notes header so crew can confirm their text reached the
  // queue (the previous behavior wrote to localStorage only - sheets never saw
  // it, so admin couldn't read the notes off-device).
  type NotesSyncStatus = "idle" | "saving" | "saved" | "offline";
  const [notesStatus, setNotesStatus] = useState<NotesSyncStatus>("idle");
  const notesSaveTimeoutRef = useRef<number | null>(null);

  // Calendar
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string>("");
  const [calWarning, setCalWarning] = useState<string>("");
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  // Persist the calendar selection within the session so it survives navigation.
  const [calSelectedId, setCalSelectedId] = useState<string>(() =>
    sessionStorage.getItem("crew_session_calId") || ""
  );
  const [calLoaded, setCalLoaded] = useState<boolean>(false);
  // Prevents the jobDate effect from clearing calSelectedId on first mount
  // (when we're restoring session state, not reacting to a user date change).
  const isFirstDateEffect = useRef(true);

  // Photos
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  // Object URLs for the local photo previews, keyed by photo id.
  //
  // Photos are stored as BYTES now (ADR 0017), so a preview URL cannot be built
  // synchronously in render the way it could from a Blob. Built here instead, and
  // revoked when the set changes, which also fixes a leak: the old code called
  // URL.createObjectURL on every render and never revoked any of them.
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const p of photos) {
        const blob = await slotToPreviewBlob(p.blob);
        if (!blob) continue; // unreadable: no thumbnail, but the row still renders
        const url = URL.createObjectURL(blob);
        made.push(url);
        next[p.id] = url;
      }
      if (cancelled) {
        made.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setPreviewUrls(next);
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [photos]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>("");
  // Pending batch: crew queue several photos (library multi-select and/or one
  // capture at a time), each with an optional note, then submit them together.
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  // Saved-gallery note editor: id of the photo whose note is open + its draft.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  // Incident reporting now lives on the Photos tab. jobIncidents feeds the
  // "attach these photos to <claim>" selector; attachIncidentUuid is the
  // currently-selected target ("" = tag the batch to the job, not an incident).
  const [jobIncidents, setJobIncidents] = useState<JobIncidentRef[]>([]);
  const [attachIncidentUuid, setAttachIncidentUuid] = useState<string>("");

  const [sendingType, setSendingType] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [dvirPending, setDvirPending] = useState<{ type: string } | null>(null);
  const [serverEvents, setServerEvents] = useState<EventRecord[]>([]);
  const [serverPhotos, setServerPhotos] = useState<ServerPhoto[]>([]);
  // event_id of the timeline row whose timestamp is currently being edited.
  // null when nothing is open. Only one row can edit at a time.
  const [editingTimeFor, setEditingTimeFor] = useState<string | null>(null);
  const [editingTimeError, setEditingTimeError] = useState<string | null>(null);

  const canSend = useMemo(() => jobUuid.trim().length > 0, [jobUuid]);

  const [historyStatus, setHistoryStatus] = useState<string>("");

  // Calendar "Other" option
  const [calOtherName, setCalOtherName] = useState<string>("");
  // Manual job entries shown as dropdown options so the crew can re-select
  // them without re-typing. Persisted to localStorage (survives refresh) and
  // synced to the backend so a name typed on one device appears on other
  // devices working the same date - see /api/jobs/manual.
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>(() => loadManualEntries());


  // -----------------------
  // Storage helpers
  // -----------------------
  function loadJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  function saveJson<T>(key: string, val: T) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // Quota exceeded or similar - surface once so the problem isn't silent.
      // Retention pruning on boot should keep us well clear of this.
      console.warn(`[storage] failed to write ${key}; log retention may need review`);
    }
  }

  function loadQueue(): EventRecord[] {
    return loadJson<EventRecord[]>(QUEUE_KEY, []);
  }

  function saveQueue(q: EventRecord[]) {
    saveJson(QUEUE_KEY, q);
    setQueueLen(q.length);
  }

  function loadNotePatchQueue(): EventPatchOp[] {
    return loadJson<EventPatchOp[]>(NOTE_PATCH_KEY, []);
  }

  function saveNotePatchQueue(q: EventPatchOp[]) {
    saveJson(NOTE_PATCH_KEY, q);
  }

  function loadLog(): EventRecord[] {
    return loadJson<EventRecord[]>(LOG_KEY, []);
  }

  function saveLog(log: EventRecord[]) {
    // Defensive cap - saveLog is called from many paths; enforce the ceiling
    // on every write rather than trusting each caller to prune.
    const capped = log.length > LOG_MAX_ENTRIES
      ? log.slice(0, LOG_MAX_ENTRIES)
      : log;
    saveJson(LOG_KEY, capped);
    setActivityLog(capped);
  }

  function commentsKeyForJob(uuid: string) {
    return `${COMMENTS_PREFIX}${uuid || "none"}`;
  }

  function loadCommentsForJob(uuid: string) {
    try {
      return localStorage.getItem(commentsKeyForJob(uuid)) || "";
    } catch {
      return "";
    }
  }

  function saveCommentsForJob(uuid: string, text: string) {
    try {
      localStorage.setItem(commentsKeyForJob(uuid), text);
    } catch {}
  }

  function jobNotesEventKey(uuid: string) {
    return `${JOB_NOTES_EVENT_PREFIX}${uuid || "none"}`;
  }
  function loadJobNotesEventId(uuid: string): string | null {
    try {
      return localStorage.getItem(jobNotesEventKey(uuid));
    } catch {
      return null;
    }
  }
  function saveJobNotesEventId(uuid: string, eventId: string) {
    try {
      localStorage.setItem(jobNotesEventKey(uuid), eventId);
    } catch {}
  }

  function notesSyncedKey(uuid: string) {
    return `${NOTES_SYNCED_PREFIX}${uuid || "none"}`;
  }
  function loadSyncedNotes(uuid: string): string {
    try {
      return localStorage.getItem(notesSyncedKey(uuid)) || "";
    } catch {
      return "";
    }
  }
  function saveSyncedNotes(uuid: string, text: string) {
    try {
      localStorage.setItem(notesSyncedKey(uuid), text);
    } catch {}
  }

  function jobNameKey(uuid: string) {
    return `${JOB_NAME_PREFIX}${uuid || "none"}`;
  }
  function jobDateKey(uuid: string) {
    return `${JOB_DATE_PREFIX}${uuid || "none"}`;
  }
  function loadJobName(uuid: string) {
    try {
      return localStorage.getItem(jobNameKey(uuid)) || "";
    } catch {
      return "";
    }
  }
  function saveJobName(uuid: string, name: string) {
    try {
      localStorage.setItem(jobNameKey(uuid), name);
    } catch {}
  }
  function loadJobDate(uuid: string) {
    try {
      return localStorage.getItem(jobDateKey(uuid)) || "";
    } catch {
      return "";
    }
  }
  function saveJobDate(uuid: string, date: string) {
    try {
      localStorage.setItem(jobDateKey(uuid), date);
    } catch {}
  }

  // NEW: Job meta + calendar binding
  function jobMetaKey(uuid: string) {
    return `${JOB_META_PREFIX}${uuid || "none"}`;
  }
  function calBindKey(date: string, calId: string) {
    return `${CAL_BIND_PREFIX}${date}:${calId}`;
  }
  function loadJobMeta(uuid: string): JobMeta | null {
    try {
      const raw = localStorage.getItem(jobMetaKey(uuid));
      if (!raw) return null;
      return JSON.parse(raw) as JobMeta;
    } catch {
      return null;
    }
  }
  function saveJobMeta(meta: JobMeta) {
    try {
      localStorage.setItem(jobMetaKey(meta.job_uuid), JSON.stringify(meta));
    } catch {}
  }
  function bindCalendarEventToJob(date: string, calId: string, uuid: string) {
    try {
      localStorage.setItem(calBindKey(date, calId), uuid);
    } catch {}
  }

  // -----------------------
  // Job switching
  // -----------------------
  function setPersistedJobUuid(val: string) {
    setJobUuid(val);
    localStorage.setItem(JOB_KEY, val);

    setJobComments(loadCommentsForJob(val));

    const meta = loadJobMeta(val);
    if (meta) {
      setJobName(meta.jobName || "");
      setJobDate(meta.jobDate || todayLocalYYYYMMDD());
    } else {
      const loadedName = loadJobName(val);
      setJobName(loadedName);
      const storedDate = loadJobDate(val);
      setJobDate(storedDate || todayLocalYYYYMMDD());
    }
    // Calendar events stay loaded so user can switch between jobs without reloading
  }

  function setPersistedJobStatus(val: "active" | "closed") {
    setJobStatus(val);
    localStorage.setItem(JOB_STATUS_KEY, val);
  }

  // -----------------------
  // Geolocation + events
  // -----------------------
  async function tryGetLocation(): Promise<{ lat: number | null; lng: number | null; accuracy_m: number | null }> {
    if (!navigator.geolocation) return { lat: null, lng: null, accuracy_m: null };

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy ?? null,
          }),
        () => resolve({ lat: null, lng: null, accuracy_m: null }),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  }

  function markLogEventsSyncedByIds(ids: Set<string>) {
    const log = loadLog();
    let changed = false;

    const updated = log.map((e) => {
      if (e.sync_status === "queued" && ids.has(e.event_id)) {
        changed = true;
        return { ...e, sync_status: "synced" as const };
      }
      return e;
    });

    if (changed) saveLog(updated);
  }

  function computeClockHoursText(log: EventRecord[]) {
    const uuid = jobUuid.trim();
    if (!uuid) return "-";

    const jobLog = log.filter((e) => e.job_uuid === uuid);

    const start = jobLog
      .filter((e) => e.type === "START")
      .map((e) => Date.parse(e.timestamp))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];

    if (!Number.isFinite(start)) return "-";

    const finishTs = jobLog
      .filter((e) => e.type === "FINISH")
      .map((e) => Date.parse(e.timestamp))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => b - a)[0];

    const end = Number.isFinite(finishTs) ? finishTs : Date.now();
    const hours = (end - start) / 3_600_000;
    return `${Math.max(0, hours).toFixed(2)} hrs`;
  }

  async function drainNotePatchQueue() {
    const q = loadNotePatchQueue();
    if (q.length === 0) return;
    if (!navigator.onLine) return;

    const token = getToken();
    const remaining: EventPatchOp[] = [];
    for (const op of q) {
      try {
        if (op.deleted) {
          const res = await fetch(`${API}/api/events/${encodeURIComponent(op.event_id)}`, {
            method: "DELETE",
            headers: makeAuthHeaders(token),
          });
          if (res.ok || res.status === 404) continue; // 404 = already gone
          remaining.push(op);
          continue;
        }
        // Send only the fields the user actually changed. Older queue
        // items predating editable timestamps just have `note`.
        const body: Record<string, unknown> = {};
        if (op.note !== undefined) body.note = op.note;
        if (op.timestamp !== undefined) body.timestamp = op.timestamp;
        const res = await fetch(`${API}/api/events/${encodeURIComponent(op.event_id)}`, {
          method: "PATCH",
          headers: makeAuthHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        if (res.ok) continue;
        // 4xx that's specifically about a malformed timestamp is permanent -
        // dropping the op prevents a wedged queue. 404 means the event hasn't
        // synced from another device yet; keep retrying on later drains.
        if (res.status === 400) continue;
        remaining.push(op);
      } catch {
        remaining.push(op);
      }
    }
    saveNotePatchQueue(remaining);
  }

  async function updateEventNote(eventId: string, noteText: string) {
    const note = noteText.trim() || null;

    const log = loadLog();
    const logIdx = log.findIndex((x) => x.event_id === eventId);
    // If this device still has the event queued for sync, just rewrite the
    // note in-place - it will ride the normal sync and the server will insert
    // it with the correct note on first arrival. No PATCH needed.
    const queuedLocally = logIdx >= 0 && log[logIdx].sync_status === "queued";
    if (logIdx >= 0) {
      const next = log.slice();
      next[logIdx] = { ...next[logIdx], note };
      saveLog(next);
    }

    const q = loadQueue();
    const qIdx = q.findIndex((x) => x.event_id === eventId);
    if (qIdx >= 0) {
      const nq = q.slice();
      nq[qIdx] = { ...nq[qIdx], note };
      saveQueue(nq);
    }

    setServerEvents((prev) => prev.map((e) => e.event_id === eventId ? { ...e, note } : e));

    if (queuedLocally) return;

    const patchQueue = loadNotePatchQueue();
    const existingIdx = patchQueue.findIndex((p) => p.event_id === eventId);
    const op: EventPatchOp = { event_id: eventId, note, enqueued_at: new Date().toISOString() };
    const nextPatchQueue = patchQueue.slice();
    // Preserve a co-pending timestamp edit if one exists for the same event,
    // so a flush sends both fields in a single PATCH.
    if (existingIdx >= 0) nextPatchQueue[existingIdx] = { ...patchQueue[existingIdx], ...op };
    else nextPatchQueue.push(op);
    saveNotePatchQueue(nextPatchQueue);

    drainNotePatchQueue();
  }

  // Delete an event logged in error (also removes the derived RODS duty change
  // when it's a DUTY event). Offline-safe: drops it from local state + the
  // outbox, and queues a DELETE for the server if it had already synced.
  async function deleteEvent(eventId: string) {
    const log = loadLog();
    const logIdx = log.findIndex((x) => x.event_id === eventId);
    const queuedLocally = logIdx >= 0 && log[logIdx].sync_status === "queued";
    if (logIdx >= 0) {
      const next = log.slice();
      next.splice(logIdx, 1);
      saveLog(next);
      setActivityLog(next);
    }
    // Drop from the outbox (an as-yet-unsynced event needs no server delete).
    const q = loadQueue();
    const qIdx = q.findIndex((x) => x.event_id === eventId);
    if (qIdx >= 0) {
      const nq = q.slice();
      nq.splice(qIdx, 1);
      saveQueue(nq);
    }
    setServerEvents((prev) => prev.filter((e) => e.event_id !== eventId));
    // Drop any pending edit for this event, then delete server-side if synced.
    const patchQueue = loadNotePatchQueue().filter((p) => p.event_id !== eventId);
    if (queuedLocally) {
      saveNotePatchQueue(patchQueue);
      return;
    }
    patchQueue.push({ event_id: eventId, deleted: true, enqueued_at: new Date().toISOString() });
    saveNotePatchQueue(patchQueue);
    drainNotePatchQueue();
  }

  async function updateEventTime(eventId: string, newTimestampIso: string) {
    // Same flow as updateEventNote: rewrite local state first so the timeline
    // re-renders immediately (mergedLog re-sorts via useMemo), then either
    // ride the next outbox sync (if still queued locally) or enqueue a
    // PATCH-time op for the server.
    const log = loadLog();
    const logIdx = log.findIndex((x) => x.event_id === eventId);
    const queuedLocally = logIdx >= 0 && log[logIdx].sync_status === "queued";
    if (logIdx >= 0) {
      const next = log.slice();
      next[logIdx] = { ...next[logIdx], timestamp: newTimestampIso };
      saveLog(next);
    }

    const q = loadQueue();
    const qIdx = q.findIndex((x) => x.event_id === eventId);
    if (qIdx >= 0) {
      const nq = q.slice();
      nq[qIdx] = { ...nq[qIdx], timestamp: newTimestampIso };
      saveQueue(nq);
    }

    setServerEvents((prev) =>
      prev.map((e) => (e.event_id === eventId ? { ...e, timestamp: newTimestampIso } : e)),
    );

    if (queuedLocally) return;

    const patchQueue = loadNotePatchQueue();
    const existingIdx = patchQueue.findIndex((p) => p.event_id === eventId);
    const op: EventPatchOp = {
      event_id: eventId,
      timestamp: newTimestampIso,
      enqueued_at: new Date().toISOString(),
    };
    const nextPatchQueue = patchQueue.slice();
    if (existingIdx >= 0) nextPatchQueue[existingIdx] = { ...patchQueue[existingIdx], ...op };
    else nextPatchQueue.push(op);
    saveNotePatchQueue(nextPatchQueue);

    drainNotePatchQueue();
  }

  // Persist the global Notes textarea for `jobUuidArg` into the same sync
  // pipeline used for activity events. The first call for a job creates a
  // sentinel JOB_NOTES event whose `note` field carries the full text;
  // subsequent calls PATCH that same event in place via the existing
  // event-patch queue. Filtered out of the timeline render so it doesn't
  // appear as activity.
  async function flushJobNotes(jobUuidArg: string, text: string) {
    if (!jobUuidArg) return;
    const noteValue = text.trim() ? text.trim() : null;

    let eventId = loadJobNotesEventId(jobUuidArg);

    if (!eventId) {
      eventId = crypto.randomUUID();
      saveJobNotesEventId(jobUuidArg, eventId);

      const nowIso = new Date().toISOString();
      const ev: EventRecord = {
        event_id: eventId,
        job_uuid: jobUuidArg,
        type: "JOB_NOTES",
        timestamp: nowIso,
        logged_at: nowIso,
        lat: null,
        lng: null,
        accuracy_m: null,
        note: noteValue,
        created_by: user?.name || user?.email || "",
        sync_status: "queued",
      };

      const log = loadLog();
      log.unshift(ev);
      saveLog(log);
      setActivityLog(log);

      const q = loadQueue();
      q.unshift(ev);
      saveQueue(q);

      saveSyncedNotes(jobUuidArg, text);

      if (navigator.onLine) {
        void syncQueueNow();
        setNotesStatus("saved");
      } else {
        setNotesStatus("offline");
      }
      return;
    }

    await updateEventNote(eventId, text);
    saveSyncedNotes(jobUuidArg, text);
    setNotesStatus(navigator.onLine ? "saved" : "offline");
  }

  async function syncQueueNow() {
    const q = loadQueue();
    if (q.length === 0) {
      setStatus("Nothing to sync");
      return;
    }

    if (!navigator.onLine) {
      setStatus(`Offline (${q.length} queued)`);
      return;
    }

    setStatus(`Syncing ${q.length}...`);

    const payload = {
      device_id: getDeviceId(),
      events: q.map((e) => ({
        event_id: e.event_id,
        job_uuid: e.job_uuid,
        job_id: null,
        type: e.type,
        timestamp: e.timestamp,
        lat: e.lat,
        lng: e.lng,
        accuracy_m: e.accuracy_m,
        note: e.note ?? null,
        job_name: loadJobMeta(e.job_uuid)?.jobName || localStorage.getItem(JOB_NAME_PREFIX + e.job_uuid) || "",
        job_date: loadJobMeta(e.job_uuid)?.jobDate || localStorage.getItem(JOB_DATE_PREFIX + e.job_uuid) || "",
        // Send the author stamped when the event was CREATED (recordEvent), not
        // whoever is logged in now. On a shared phone the sync can fire under a
        // different session than the one that logged the event; overwriting with
        // the current user misattributed A's field work to B. Fall back to the
        // current user only for legacy queued events that predate this and have
        // no stored author.
        created_by: e.created_by || user?.name || user?.email || "",
      })),
    };

    try {
      const token = getToken();
      const res = await fetch(`${API}/api/sync`, {
        method: "POST",
        headers: makeAuthHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      // An event the server "handled" - inserted, deduped, or *permanently*
      // rejected (e.g. a malformed timestamp) - leaves the queue; retrying it
      // would just wedge the queue. But a `retryable` failure (a transient
      // server-side DB error means the event never persisted) must stay
      // queued - dropping it silently loses a logged field event.
      if (json?.ok === true) {
        const failed: { event_id: string; reason?: string; retryable?: boolean }[] =
          json.failed ?? [];
        const retryableIds = new Set(
          failed.filter((f) => f.retryable).map((f) => f.event_id),
        );
        const permanentFailed = failed.filter((f) => !f.retryable);

        const handledIds = new Set(
          q.map((e) => e.event_id).filter((id) => !retryableIds.has(id)),
        );
        markLogEventsSyncedByIds(handledIds);
        const remaining = q.filter((e) => retryableIds.has(e.event_id));
        saveQueue(remaining);

        if (permanentFailed.length > 0) {
          console.warn(
            `[sync] server rejected ${permanentFailed.length} event(s):`,
            permanentFailed
              .map((f) => `${f.event_id} (${f.reason ?? "unknown"})`)
              .join(", "),
          );
        }
        if (remaining.length > 0) {
          setStatus(`Synced - ${remaining.length} will retry`);
        } else if (permanentFailed.length > 0) {
          setStatus(`Synced - ${permanentFailed.length} rejected`);
        } else {
          setStatus("Synced");
        }
      } else {
        setStatus("Sync failed (kept queued)");
        saveQueue(q);
      }
    } catch (e: any) {
      setStatus(`Sync error (kept queued)`);
      saveQueue(q);
    }

    // Post-sync: any note edits the user made after an event first synced
    // still need to ship. This also catches patches queued up while offline.
    drainNotePatchQueue();
  }

  async function recordEvent(type: string, note: string | null = null) {
    if (!canSend || sendingType !== null) return;

    setSendingType(type);
    setStatus("Capturing...");

    const loc = await tryGetLocation();

    const nowIso = new Date().toISOString();
    const ev: EventRecord = {
      event_id: crypto.randomUUID(),
      job_uuid: jobUuid.trim(),
      type,
      // On capture, the editable event time and the immutable logged_at are
      // the same - both reflect the device clock at the moment of the tap.
      // They diverge only after the user edits `timestamp` from the timeline.
      timestamp: nowIso,
      logged_at: nowIso,
      lat: loc.lat,
      lng: loc.lng,
      accuracy_m: loc.accuracy_m,
      note,
      created_by: user?.name || user?.email || "",
      sync_status: "queued",
    };

    const log = loadLog();
    log.unshift(ev);
    saveLog(log);

    const q = loadQueue();
    q.unshift(ev);
    saveQueue(q);

    if (type === "FINISH") setPersistedJobStatus("closed");

    try {
      await syncQueueNow();
    } finally {
      setSendingType(null);
    }
  }

  // ── Loaded-weight capture (B3/B4). Logging a weight creates a WEIGHT event, so
  // it is timestamped, offline-queued, cross-device, and visible to anyone in the
  // timeline + the "Loaded weights" summary. No new store needed. ──
  const [vehUnits, setVehUnits] = useState<VehicleUnit[]>(() => getVehUnitsCached());
  useEffect(() => { refreshVehUnits().then(setVehUnits).catch(() => {}); }, []);
  const [showWeightEntry, setShowWeightEntry] = useState(false);
  const [weightVal, setWeightVal] = useState("");
  const [weightUnit, setWeightUnit] = useState("");
  async function logWeight() {
    const n = Number(weightVal);
    if (!Number.isFinite(n) || n <= 0) { setStatus("Enter a loaded weight in pounds."); return; }
    const unit = weightUnit.trim();
    const note = `${Math.round(n).toLocaleString()} lb${unit ? ` · ${unit}` : ""}`;
    await recordEvent("WEIGHT", note);
    setWeightVal("");
    setShowWeightEntry(false);
  }

  // -----------------------
  // Calendar binding
  // -----------------------
  async function loadCalendarEvents() {
    setCalError("");
    setCalWarning("");
    setCalLoading(true);
    setCalEvents([]);
    // Do NOT clear calSelectedId here - callers own that decision.
    // The date-change effect clears it before calling; the first-mount
    // guard intentionally preserves the sessionStorage-restored value.
    setCalLoaded(false);

    // Pull manual entries for this date in parallel so cross-device names
    // land in the dropdown alongside the calendar events.
    void fetchManualEntriesForDate(jobDate);

    try {
      const token = getToken();
      const res = await fetch(`${API}/api/calendar/day?date=${encodeURIComponent(jobDate)}`, {
        headers: makeAuthHeaders(token),
      });
      const json = await res.json();

      if (!res.ok) {
        setCalError(String(json?.detail || `Calendar HTTP ${res.status}`));
        setCalLoading(false);
        setCalLoaded(true);
        return;
      }

      if (json?.ok !== true) {
        setCalError(String(json?.detail || "Calendar fetch failed"));
        setCalLoading(false);
        setCalLoaded(true);
        return;
      }

      setCalEvents((json?.events ?? []) as CalEvent[]);
      setCalWarning(String(json?.warning || ""));
      setCalLoading(false);
      setCalLoaded(true);
      setStatus("Calendar loaded");
    } catch (e: any) {
      setCalError(e?.message ?? "Calendar error");
      setCalLoading(false);
      setCalLoaded(true);
    }
  }

  async function fetchManualEntriesForDate(date: string) {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/jobs/manual?date=${encodeURIComponent(date)}`, {
        headers: makeAuthHeaders(token),
      });
      if (!res.ok) return;
      const json = await res.json();
      const remote: { job_uuid: string; name: string }[] = json?.entries ?? [];
      if (!Array.isArray(remote) || remote.length === 0) return;
      setManualEntries((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]));
        for (const r of remote) {
          byId.set(r.job_uuid, { id: r.job_uuid, summary: r.name, date });
        }
        const next = Array.from(byId.values());
        saveManualEntries(next);
        return next;
      });
    } catch { /* offline is fine */ }
  }

  // Called on blur of the manual-entry input. Derives the canonical job_uuid
  // deterministically from (name, jobDate) so any device typing the same
  // name for the same day gets the same UUID and their events auto-merge.
  // Persists to localStorage + best-effort POSTs to the backend so the entry
  // shows up in other crew members' dropdowns for that date.
  function confirmManualEntry() {
    const name = calOtherName.trim();
    if (!name) return;
    const canonicalUuid = manualJobToJobUuid(name, jobDate);

    setPersistedJobUuid(canonicalUuid);
    setPersistedJobStatus("active");
    setJobName(name);
    setStatus("Job selected");
    saveJobMeta({ job_uuid: canonicalUuid, jobName: name, jobDate, source: "manual", updated_at: new Date().toISOString() });

    const entry: ManualEntry = { id: canonicalUuid, summary: name, date: jobDate };
    setManualEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === canonicalUuid);
      const next = idx >= 0 ? prev.map((e, i) => (i === idx ? entry : e)) : [...prev, entry];
      saveManualEntries(next);
      return next;
    });
    setCalSelectedId(canonicalUuid);
    fetchJobEvents(canonicalUuid);
    fetchServerPhotos(canonicalUuid);

    // Best-effort backend upsert. If it fails (offline / 5xx), the local
    // entry still works; the next successful call reconciles.
    (async () => {
      try {
        const token = getToken();
        await fetch(`${API}/api/jobs/manual`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...makeAuthHeaders(token) },
          body: JSON.stringify({ job_uuid: canonicalUuid, name, date: jobDate }),
        });
      } catch { /* offline is fine - retried next confirm or by list-fetch */ }
    })();
  }

  async function onSelectCalendarEvent(calId: string) {
    setCalSelectedId(calId);

    if (calId === "__other__") {
      // Don't create a UUID yet - it's derived from the name on blur so
      // two devices typing the same name land on the same UUID.
      setCalOtherName("");
      setPersistedJobUuid("");
      setJobName("");
      setStatus("Manual job - enter description below");
      return;
    }

    // Re-selecting a previously confirmed manual entry - restore UUID + name.
    const manualEntry = manualEntries.find((e) => e.id === calId);
    if (manualEntry) {
      setPersistedJobUuid(calId);
      setPersistedJobStatus("active");
      setJobName(manualEntry.summary);
      setStatus("Job selected");
      fetchJobEvents(calId);
      fetchServerPhotos(calId);
      return;
    }

    const ev = calEvents.find((x) => x.id === calId);
    if (!ev) return;

    // Ask the server for the canonical UUID for this calendar event.
    // All devices get the same UUID back, so cross-device history works.
    // Falls back to a local deterministic hash if offline.
    let jobId: string;
    try {
      const token = getToken();
      // Pass the event's scheduled window so the server caches it for the
      // est-vs-actual scheduled-duration fallback.
      let resolveUrl = `${API}/api/jobs/resolve?calendar_event_id=${encodeURIComponent(calId)}`;
      if (ev.start) resolveUrl += `&scheduled_start=${encodeURIComponent(ev.start)}`;
      if (ev.end) resolveUrl += `&scheduled_end=${encodeURIComponent(ev.end)}`;
      if (typeof ev.invitees === "number") resolveUrl += `&invitee_count=${ev.invitees}`;
      const res = await fetch(resolveUrl, {
        headers: makeAuthHeaders(token),
      });
      if (res.ok) {
        const json = await res.json();
        jobId = json.job_uuid;
      } else {
        jobId = calEventToJobUuid(calId);
      }
    } catch {
      jobId = calEventToJobUuid(calId);
    }

    setPersistedJobUuid(jobId);
    setPersistedJobStatus("active");

    bindCalendarEventToJob(jobDate, calId, jobId);

    setJobName(ev.summary);

    saveJobMeta({
      job_uuid: jobId,
      jobName: ev.summary,
      jobDate,
      source: "calendar",
      calendarEventId: calId,
      updated_at: new Date().toISOString(),
    });

    saveJobName(jobId, ev.summary);
    saveJobDate(jobId, jobDate);

    setStatus("Job selected");
    fetchJobEvents(jobId);
    fetchServerPhotos(jobId);
  }

  // Fetch event history from backend and merge into local log.
  // Runs on startup so mobile devices (with empty localStorage) can see past events.
  async function loadHistoryFromBackend() {
    if (!navigator.onLine) return;
    setHistoryStatus("Syncing history…");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/events?limit=2000`, {
        headers: makeAuthHeaders(token),
      });
      if (!res.ok) {
        setHistoryStatus(`History sync failed (HTTP ${res.status})`);
        return;
      }
      const json = await res.json();
      if (!json.ok || !Array.isArray(json.events) || json.events.length === 0) {
        setHistoryStatus("No events on server yet");
        return;
      }

      const localLog = loadLog();
      const localIds = new Set(localLog.map((e) => e.event_id));

      const incoming: EventRecord[] = json.events
        .filter((e: any) => !localIds.has(e.event_id))
        .map((e: any) => ({
          event_id: e.event_id,
          job_uuid: e.job_uuid,
          type: e.type,
          timestamp: e.timestamp,
          logged_at: e.logged_at ?? e.timestamp,
          lat: e.lat ?? null,
          lng: e.lng ?? null,
          accuracy_m: e.accuracy_m ?? null,
          note: e.note ?? null,
          created_by: e.created_by || "",
          sync_status: "synced" as const,
        }));

      // Restore job names into localStorage so the map tooltips and job name fields work
      incoming.forEach((e: any) => {
        const raw = json.events.find((r: any) => r.event_id === e.event_id);
        if (!raw?.job_name) return;
        const existingMeta = loadJobMeta(e.job_uuid);
        if (!existingMeta) {
          saveJobMeta({
            job_uuid: e.job_uuid,
            jobName: raw.job_name,
            jobDate: mountainDateYYYYMMDD(e.timestamp),
            source: "calendar",
            updated_at: new Date().toISOString(),
          });
        }
      });

      const merged = [...incoming, ...localLog].sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
      );
      saveLog(merged);
      setHistoryStatus(incoming.length > 0 ? `Synced ${incoming.length} new event(s)` : "History up to date");
    } catch (err: any) {
      setHistoryStatus(`History sync error: ${err?.message ?? "network error"}`);
    }
  }

  async function fetchJobEvents(uuid: string) {
    if (!uuid.trim()) return;
    try {
      const data = await apiFetch<{ ok: boolean; events: EventRecord[] }>(`/api/events?job_uuid=${encodeURIComponent(uuid)}`);
      if (data?.events) setServerEvents(data.events);
    } catch {
      // offline or error - server events unavailable, local queue still shown
    }
  }

  async function fetchServerPhotos(uuid: string) {
    if (!uuid.trim()) return;
    try {
      const data = await apiFetch<{ ok: boolean; photos: ServerPhoto[] }>(`/api/photos?job_uuid=${encodeURIComponent(uuid)}`);
      if (data?.photos) setServerPhotos(data.photos);
    } catch {
      // offline - server photos unavailable
    }
  }

  // Manual cross-device pull. Cross-device sync otherwise only reconciles on
  // reconnect / mount, so a crew member on one device can't see what a teammate
  // just logged to the same job. This pushes my own pending work up first (so
  // the refresh reconciles both ways), then pulls the job's server state:
  // timeline events, photos, and materials. Wired to a persistent Refresh button
  // in the hub header, visible on every tab.
  const [refreshing, setRefreshing] = useState(false);
  async function refreshFromServer() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await syncQueueNow();
      const uuid = jobUuid.trim();
      if (uuid) {
        await Promise.all([
          fetchJobEvents(uuid),
          fetchServerPhotos(uuid),
          syncMaterialsInBackground(uuid),
        ]);
      }
    } finally {
      setRefreshing(false);
    }
  }

  // -----------------------
  // Photos
  // -----------------------

  // Parse the upload response into either an error string or a usable body.
  // Used by both the initial-save and retry paths so the wording stays consistent
  // and so the response body is only consumed once.
  async function readPhotoUploadResponse(res: Response): Promise<{ error: string | null; body: any }> {
    if (res.status === 401) {
      // Token expired or revoked. Wipe it so the next render kicks the user
      // back to the login screen - otherwise they keep tapping Retry and seeing
      // "HTTP 401" without any explanation of what to do.
      clearToken();
      return { error: "Session expired - log out and sign in again to upload photos", body: null };
    }
    if (res.status === 413) {
      return { error: "Photo too large to upload (server limit is 100 MB)", body: null };
    }
    if (res.status === 403) {
      return { error: "Server rejected the upload (not authorized)", body: null };
    }
    if (res.status >= 500) {
      return { error: `Server error (HTTP ${res.status}) - try again in a moment`, body: null };
    }
    let body: any = null;
    try { body = await res.json(); }
    catch { return { error: "Upload failed - server returned an unreadable response", body: null }; }
    if (body && body.ok === false) {
      const msg = body.error ? `Drive upload failed: ${body.error}` : "Drive upload failed";
      return { error: msg, body };
    }
    if (!res.ok) {
      return { error: `Upload failed (HTTP ${res.status})`, body };
    }
    if (!body || !body.drive_url) {
      return { error: "Drive upload didn't complete - please retry", body };
    }
    return { error: null, body };
  }

  async function refreshPhotos() {
    try {
      setPhotoError("");
      const list = await listPhotosForJob(jobUuid.trim());
      setPhotos(list);
    } catch (e: any) {
      setPhotoError(e?.message ?? "Could not load photos");
    }
  }

  // Count photos tagged to each incident (local + server), deduped by photo id,
  // so the incident rows can show "N photos attached".
  const incidentPhotoCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const p of photos) {
      if (!p.incident_uuid) continue;
      seen.add(p.id);
      counts[p.incident_uuid] = (counts[p.incident_uuid] || 0) + 1;
    }
    for (const sp of serverPhotos) {
      if (!sp.incident_uuid || seen.has(sp.id)) continue;
      counts[sp.incident_uuid] = (counts[sp.incident_uuid] || 0) + 1;
    }
    return counts;
  }, [photos, serverPhotos]);

  // Reset the photo attach target when the job changes. Keyed on jobUuid (not
  // on jobIncidents) so it can't race the onReported auto-select: jobIncidents
  // updates a render after onReported sets the target, and keying on it here
  // would clobber the just-selected incident before the list caught up.
  useEffect(() => {
    setAttachIncidentUuid("");
  }, [jobUuid]);

  // Append one or more picked/taken files to the pending batch. Called by both
  // the "Add from Library" (multiple) and "Take Photo" (capture) inputs, so a
  // crew member can accumulate several shots before submitting.
  function onAddPhotoFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!jobUuid.trim()) { setPhotoError("Select a job first"); return; }
    setPhotoError("");
    const additions: PendingPhoto[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      caption: "",
    }));
    setPendingPhotos((prev) => [...prev, ...additions]);
  }

  function setPendingCaptionFor(id: string, caption: string) {
    setPendingPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  }

  function removePendingPhoto(id: string) {
    setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  // Save one photo: store locally first (offline-safe), then attempt the Drive
  // upload. Drive failures leave the photo queued as "failed"/"pending" for the
  // Retry button - they never lose the local copy.
  async function uploadOnePhoto(photoId: string, file: File, caption: string) {
    // Resolve the incident this batch is tagged to (if any). "" target = a plain
    // job photo. A stale selection (incident not in the current list) is ignored.
    const inc = attachIncidentUuid
      ? jobIncidents.find((x) => x.incident_uuid === attachIncidentUuid)
      : undefined;
    // Store the photo's BYTES, not the File.
    //
    // A File off an <input> is a reference to a file on disk, not the data. This
    // queue persists it and uploads it later, sometimes days later, across
    // reloads. On iOS/WebKit that reference can go stale, and a stale File does
    // not fail loudly: appending it to FormData yields a request whose body never
    // serialises, so the server sees an empty body. Reading it once, here, while
    // the handle is still live, makes the queued photo self-contained. See
    // ADR 0017.
    const stored: StoredPhoto = {
      id: photoId,
      job_uuid: jobUuid.trim(),
      created_at: new Date().toISOString(),
      mime: file.type || "image/jpeg",
      caption,
      blob: await toQueuedPhoto(file),
      drive_status: "pending",
      incident_uuid: inc?.incident_uuid,
      claim_number: inc?.claim_number,
    };
    await addPhoto(stored);

    try {
      const form = new FormData();
      const resized = await resizeImage(file);
      form.append("file", resized, (file.name || "photo.jpg").replace(/.[^.]+$/, ".jpg"));
      form.append("photo_id", photoId);
      form.append("job_uuid", jobUuid.trim());
      form.append("job_name", jobName);
      form.append("job_date", jobDate);
      form.append("caption", caption);
      if (inc) {
        form.append("incident_uuid", inc.incident_uuid);
        form.append("claim_number", inc.claim_number || "");
      }

      const token = getToken() || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: makeAuthHeaders(token),
        body: form,
      });
      const { error, body } = await readPhotoUploadResponse(res);
      if (!error && body?.drive_url) {
        await updatePhoto(photoId, { drive_status: "uploaded", drive_url: body.drive_url });
      } else {
        await updatePhoto(photoId, { drive_status: "failed", drive_error: error ?? "Drive upload failed" });
      }
    } catch (uploadErr: any) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const msg = offline
        ? "Offline - photo will retry when you're back online"
        : (uploadErr?.message ?? "Network error - tap Retry");
      await updatePhoto(photoId, { drive_status: "failed", drive_error: msg });
    }
  }

  async function onSaveAllPending() {
    if (pendingPhotos.length === 0 || !jobUuid.trim()) return;
    setPhotoBusy(true);
    setPhotoError("");

    const batch = pendingPhotos;
    let saved = 0;
    let lastErr = "";
    // Sequential: keeps peak memory and server load bounded, and preserves the
    // offline-first "local save always succeeds" guarantee per photo.
    for (const p of batch) {
      try {
        await uploadOnePhoto(p.id, p.file, p.caption.trim());
        saved++;
      } catch (e: any) {
        lastErr = e?.message ?? "Photo save failed";
      }
    }

    setPendingPhotos([]);
    await refreshPhotos();
    if (lastErr) setPhotoError(lastErr);
    setStatus(saved === 1 ? "Photo saved" : `${saved} photos saved`);
    setPhotoBusy(false);
  }

  // Add/edit a note on an already-saved photo (from the Saved gallery). Updates
  // the local copy when present and syncs to the server so the note lands in
  // the DB and on the Drive file. Offline: the local caption is saved and the
  // eventual upload/retry carries it; server-only photos need connectivity.
  async function onSaveNote(id: string, caption: string, isLocal: boolean) {
    setPhotoBusy(true);
    setPhotoError("");
    try {
      if (isLocal) await updatePhoto(id, { caption });
      try {
        await apiFetch(`/api/photos/caption`, {
          method: "POST",
          body: JSON.stringify({ photo_id: id, caption }),
        });
      } catch {
        // Offline or not-yet-uploaded: local caption is saved above and will
        // ride along on the next upload/retry. Non-fatal.
      }
      await refreshPhotos();
      await fetchServerPhotos(jobUuid.trim());
      setEditingNoteId(null);
      setNoteDraft("");
      setStatus("Note saved");
    } catch (e: any) {
      setPhotoError(e?.message ?? "Could not save note");
    } finally {
      setPhotoBusy(false);
    }
  }

  // Push one already-stored photo to Drive, updating its drive_status. Returns
  // null on success or the error message on failure. Shared by the manual Retry
  // button and the automatic drain below, so the two can never diverge.
  //
  // Safe to call concurrently with an in-flight upload of the same photo: the
  // endpoint is idempotent by photo_id (an existing row short-circuits before
  // the Drive call, because Drive uploads themselves are NOT idempotent and
  // would otherwise duplicate the file).
  async function pushPhotoToDrive(photo: StoredPhoto): Promise<string | null> {
    try {
      const form = new FormData();
      // Materialise the bytes BEFORE building the request. A dead handle throws
      // here, where the photo is marked failed and the crew member is told, rather
      // than silently producing a request with no body (ADR 0017).
      const source = await slotToBlob(photo.blob);
      if (!source) throw new Error("Photo has no image data");
      const resized = await resizeImage(source);
      form.append("file", resized, photo.id + ".jpg");
      form.append("photo_id", photo.id);
      form.append("job_uuid", photo.job_uuid);
      form.append("job_name", jobName);
      form.append("job_date", jobDate);
      form.append("caption", photo.caption);
      if (photo.incident_uuid) {
        form.append("incident_uuid", photo.incident_uuid);
        form.append("claim_number", photo.claim_number || "");
      }
      const token = getToken() || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: makeAuthHeaders(token),
        body: form,
      });
      const { error, body } = await readPhotoUploadResponse(res);
      if (!error && body?.drive_url) {
        await updatePhoto(photo.id, { drive_status: "uploaded", drive_url: body.drive_url });
        return null;
      }
      const errMsg = error ?? "Drive upload failed";
      await updatePhoto(photo.id, { drive_status: "failed", drive_error: errMsg });
      return errMsg;
    } catch (uploadErr: any) {
      // An unreadable photo is not a network problem and retrying will never fix
      // it, so do not tell the crew member it will retry when they are back
      // online. Say what actually happened and what to do (ADR 0017). The row is
      // kept either way - it is never deleted out from under them.
      if (uploadErr instanceof UnreadablePhotoError) {
        const msg = "This photo can no longer be read from this phone. Retake it.";
        await updatePhoto(photo.id, { drive_status: "failed", drive_error: msg });
        return msg;
      }
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      const msg = offline
        ? "Offline - photo will retry when you're back online"
        : (uploadErr?.message ?? "Network error - tap Retry");
      await updatePhoto(photo.id, { drive_status: "failed", drive_error: msg });
      return msg;
    }
  }

  async function onRetryPhotoUpload(photo: StoredPhoto) {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    await updatePhoto(photo.id, { drive_status: "pending", drive_error: undefined });
    await refreshPhotos();
    const errMsg = await pushPhotoToDrive(photo);
    if (errMsg) setPhotoError(errMsg);
    else setStatus("Photo uploaded to Drive");
    await refreshPhotos();
    setPhotoBusy(false);
  }

  // Drain the active job's un-uploaded photos on reconnect.
  //
  // Photos were the one queue with no automatic drain: the UI promised the crew
  // "photo will retry when you're back online", but only the manual Retry button
  // ever re-pushed, so a photo taken offline sat on the device until someone
  // noticed the failed badge and tapped it. Every other queue in the app drains
  // on the `online` event; photos now do too.
  //
  // Silent by design: no photoBusy, no error banner. This runs unprompted in the
  // background, and a failure here is not something the crew asked for and can
  // act on. It just leaves the photo queued (still marked failed, still
  // retryable) for the next reconnect or a manual tap.
  const drainingPhotosRef = useRef(false);
  async function drainPendingPhotos() {
    if (!navigator.onLine) return;
    if (drainingPhotosRef.current) return;
    const uuid = jobUuid.trim();
    if (!uuid) return;

    drainingPhotosRef.current = true;
    try {
      const stuck = (await listPhotosForJob(uuid)).filter((p) => p.drive_status !== "uploaded");
      if (stuck.length === 0) return;
      for (const p of stuck) {
        // Signal can drop again mid-drain. Stop rather than burning through the
        // rest of the batch marking everything failed.
        if (!navigator.onLine) break;
        await pushPhotoToDrive(p);
      }
      await refreshPhotos();
    } finally {
      drainingPhotosRef.current = false;
    }
  }

  async function onDeletePhoto(id: string) {
    const ok = window.confirm("Delete this photo?");
    if (!ok) return;

    setPhotoBusy(true);
    setPhotoError("");

    try {
      await deletePhoto(id);
      await refreshPhotos();
      setStatus("Photo deleted");
    } catch (e: any) {
      setPhotoError(e?.message ?? "Delete failed");
    } finally {
      setPhotoBusy(false);
    }
  }

  // Drain offline-queued materials + warm the cache so the Invoice Builder
  // opens with fresh data. No render - the visible summary lives only in
  // the Invoice Builder on the Report tab.
  async function syncMaterialsInBackground(uuid: string) {
    const trimmed = uuid.trim();
    if (!trimmed) return;
    await syncMaterialsQueue();
    await fetchAndCacheMaterials(trimmed);
  }

  // -----------------------
  // Effects
  // -----------------------
  useEffect(() => {
    // Calendar auto-loads via the jobDate effect's first-mount branch below, so
    // we deliberately don't call loadCalendarEvents() here too - it was firing
    // twice on every cold boot (a wasted duplicate /api/calendar/day +
    // /api/jobs/manual against a spun-down backend).
    // Load server events for any active job
    if (jobUuid.trim()) fetchJobEvents(jobUuid.trim());

    const q = loadQueue();
    setQueueLen(q.length);

    const log = loadLog();
    setActivityLog(log);

    setJobComments(loadCommentsForJob(jobUuid));

    // Rehydrate the active job's name on boot, but leave jobDate at today
    // (the useState initializer). Crews log in to work today's jobs - showing
    // last session's date in the Timeline filter was confusing.
    const meta = loadJobMeta(jobUuid);
    if (meta) {
      setJobName(meta.jobName || "");
    } else {
      setJobName(loadJobName(jobUuid));
    }

    // Restore history from backend so mobile devices aren't empty on first load
    loadHistoryFromBackend();
    syncMaterialsInBackground(jobUuid);

    // Fetch the user directory so we can show crew members' profile photos in
    // activity entries and photo attributions.
    ensureDirectory().catch(() => { /* offline - fall back to initials */ });

    const onOnline = () => { setIsOnline(true); syncQueueNow(); drainNotePatchQueue(); syncMaterialsInBackground(jobUuid); drainIncidents(); drainOffJob(); void drainBugReports(); void drainFeatureRequests(); void drainPendingPhotos(); void drainJobInventory(); void drainJobSetups(); void drainChecklistChecks(); };
    const onOffline = () => setIsOnline(false);
    // Flush any incidents + off-job hours + un-uploaded photos queued while
    // offline on this mount too.
    drainIncidents();
    drainOffJob();
    void drainBugReports();
    void drainFeatureRequests();
    void drainPendingPhotos();
    // Inventory adds queued offline: drained here rather than only inside
    // ActualInventory, because that component no longer mounts on local jobs.
    // Anything a crew member logged before the tab went away still syncs.
    void drainJobInventory();
    // Job-setup headers saved offline (C1.2).
    void drainJobSetups();
    // Checklist manual ticks saved offline (C3).
    void drainChecklistChecks();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => setClockText(computeClockHoursText(activityLog));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid, jobStatus, activityLog]);

  useEffect(() => {
    const uuid = jobUuid.trim();
    if (!uuid) return;

    // Always persist locally on every keystroke so a refresh never loses text,
    // independent of the debounced backend flush below.
    saveCommentsForJob(uuid, jobComments);

    const synced = loadSyncedNotes(uuid);
    if (jobComments === synced) {
      setNotesStatus("idle");
      return;
    }

    if (notesSaveTimeoutRef.current !== null) {
      window.clearTimeout(notesSaveTimeoutRef.current);
    }
    setNotesStatus("saving");
    notesSaveTimeoutRef.current = window.setTimeout(() => {
      notesSaveTimeoutRef.current = null;
      void flushJobNotes(uuid, jobComments);
    }, 1500);

    return () => {
      if (notesSaveTimeoutRef.current !== null) {
        window.clearTimeout(notesSaveTimeoutRef.current);
        notesSaveTimeoutRef.current = null;
      }
    };
  }, [jobUuid, jobComments]);

  // When connectivity returns, kick both sync queues and reconcile the Notes
  // pill. The window 'online' event listener at mount also drains the queues,
  // but doesn't fire on every transition (some browsers miss it after sleep
  // or VPN flaps). Driving the drain off React's isOnline state catches those
  // gaps. Cheap: both functions early-return when their queue is empty.
  useEffect(() => {
    if (!isOnline) return;
    void syncQueueNow();
    void drainNotePatchQueue();
    void drainPendingPhotos();
    if (notesStatus === "offline") setNotesStatus("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // When the server-events fetch returns a JOB_NOTES row for the active job,
  // mirror it into local state so a fresh device/install sees notes typed
  // on another device. Only hydrate when the user hasn't typed anything
  // locally yet - otherwise their unsaved keystrokes would be clobbered.
  useEffect(() => {
    const uuid = jobUuid.trim();
    if (!uuid) return;
    const notesEvent = serverEvents.find(
      (e) => e.job_uuid === uuid && e.type === "JOB_NOTES",
    );
    if (!notesEvent) return;

    if (loadJobNotesEventId(uuid) !== notesEvent.event_id) {
      saveJobNotesEventId(uuid, notesEvent.event_id);
    }

    const localText = loadCommentsForJob(uuid);
    const serverText = notesEvent.note ?? "";
    if (!localText && serverText) {
      saveSyncedNotes(uuid, serverText);
      setJobComments(serverText);
    } else if (localText && localText === serverText) {
      // Local and server agree - record the sync baseline so the autosave
      // effect doesn't fire a needless re-flush.
      saveSyncedNotes(uuid, serverText);
    }
  }, [jobUuid, serverEvents]);

  useEffect(() => {
    if (!jobUuid.trim()) return;
    saveJobName(jobUuid.trim(), jobName);
  }, [jobUuid, jobName]);

  useEffect(() => {
    if (!jobUuid.trim()) return;
    saveJobDate(jobUuid.trim(), jobDate);
  }, [jobUuid, jobDate]);

  // Sync date + calendar selection to sessionStorage so they survive navigation.
  useEffect(() => { sessionStorage.setItem("crew_session_jobDate", jobDate); }, [jobDate]);
  useEffect(() => { sessionStorage.setItem("crew_session_calId", calSelectedId); }, [calSelectedId]);

  // When date changes, calendar results are stale. On first mount we're
  // restoring session state - skip the clear so the restored calSelectedId
  // survives until the events reload and the dropdown can match it.
  useEffect(() => {
    if (isFirstDateEffect.current) {
      isFirstDateEffect.current = false;
      loadCalendarEvents();
      return;
    }
    setCalSelectedId("");
    setCalEvents([]);
    setCalError("");
    setCalWarning("");
    setCalLoaded(false);
    loadCalendarEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDate]);

  useEffect(() => {
    if (tab !== "photos") return;
    refreshPhotos();
    fetchServerPhotos(jobUuid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, jobUuid]);

  // Select visibility on dark theme
  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "rgba(255,255,255,0.08)",
    color: "var(--text)",
    outline: "none",
  };
  const optionStyle: React.CSSProperties = { color: "#0b1220", background: "#ffffff" };

  const mergedLog = useMemo(() => {
    const uuid = jobUuid.trim();
    if (!uuid) return [];
    const localByJob = activityLog.filter((e) => e.job_uuid === uuid);
    const serverByJob = serverEvents.filter((e) => e.job_uuid === uuid);
    const serverById = new Map(serverByJob.map((e) => [e.event_id, e]));
    const localIds = new Set(localByJob.map((e) => e.event_id));

    // For events already synced to the server, prefer the server's copy -
    // it carries the latest note and editable timestamp regardless of which
    // device made the edit. The local cache can be stale (was populated on
    // an earlier history sync, before another device added a note); without
    // this preference, the stale local row hides the updated note forever.
    // Local wins only when an event is still queued locally - the server
    // doesn't have that one yet.
    const reconciled = localByJob.map((e) =>
      e.sync_status === "queued" ? e : (serverById.get(e.event_id) ?? e)
    );
    const serverOnly = serverByJob.filter((e) => !localIds.has(e.event_id));
    // JOB_NOTES is a sentinel event used to ferry the global Notes textarea
    // through the sync pipeline; it carries no activity meaning, so hide it
    // from the timeline view (the textarea itself is its UI).
    return [...reconciled, ...serverOnly]
      .filter((e) => e.type !== "JOB_NOTES")
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activityLog, serverEvents, jobUuid]);

  const calPlaceholder = useMemo(() => {
    if (calLoading) return "Loading…";
    if (!calLoaded) return "Load calendar first";
    if (calEvents.length > 0) return "Select…";
    return "No jobs found (try another date)";
  }, [calLoading, calLoaded, calEvents.length]);

  // Manual entries relevant to the currently-viewed date - fed into the
  // Select Job dropdown alongside Google Calendar events.
  const manualCalEntries = useMemo(
    () => manualEntries.filter((e) => e.date === jobDate),
    [manualEntries, jobDate],
  );

  return (
    <div className="container">
      {/* Top bar */}
      <div className="topbar">
        <div className="brand">
          <img
            className="logo"
            src={logo}
            alt="Logo"
            style={{
              // Inversion is only applied to the "light" variant - the
              // placeholder file is the original dark-pixel logo, so inverting
              // makes it readable on dark backgrounds. The "dark" variant
              // renders as-is for use on light backgrounds. When real
              // pre-coloured art is dropped into logo_light.png /
              // logo_dark.png, delete the filter entirely.
              filter: logoVariant === "light" ? "invert(1) brightness(1.15) contrast(1.05)" : undefined,
            }}
          />
          <div>
            <div className="title">Mountaineer Moving Co.</div>
            <div className="small">{clockText === "-" ? "Clock starts at Start" : `Clock: ${clockText}`}</div>
          </div>
        </div>

        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={refreshFromServer}
            disabled={refreshing || !isOnline}
            title="Pull the latest data other crew logged for this job"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "none", border: "1px solid var(--border)", borderRadius: 8,
              color: "var(--text)", padding: "4px 8px", fontSize: 12, fontWeight: 600,
              cursor: refreshing || !isOnline ? "default" : "pointer",
              opacity: !isOnline ? 0.5 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <span className="statusDot mono" style={{ ["--dot" as any]: isOnline ? "var(--ok)" : "var(--danger)", fontSize: 12 }}>
            {isOnline ? "Online" : "Offline"}
          </span>
          <span className="statusDot" style={{ ["--dot" as any]: queueLen > 0 ? "var(--brand2)" : "var(--muted)", fontSize: 12 }}>
            Queue <span className="mono">{queueLen}</span>
          </span>
          <span className="statusDot" style={{ ["--dot" as any]: jobStatus === "active" ? "var(--ok)" : "var(--muted)", textTransform: "capitalize", fontSize: 12 }}>
            {jobStatus}
          </span>
          {/* DVIR + Profile live in the persistent bottom nav; their top-bar
              buttons were removed as redundant. The "new patch notes" dot moved
              to the bottom-nav Profile tab. Admin stays (not in the crew bottom
              nav, so this is its only entry point). */}
          {user?.role === "admin" && (
            <button
              onClick={() => nav("/admin")}
              style={{ cursor: "pointer", background: "none", border: "none", color: "var(--muted)", fontSize: 13, fontWeight: 600, padding: "4px 4px" }}
            >
              Admin
            </button>
          )}
        </div>
      </div>

      {/* Admin notes - global, then per-job when a job is selected */}
      <AdminNotesBanner scope="global" />
      {jobUuid && <AdminNotesBanner key={jobUuid} scope={jobUuid} />}

      {/* DQ missing-docs reminder (C4): shows when the driver owes documents. */}
      <DqReminderBanner />

      {/* Job selector + core actions: always visible (drill-in home context). */}
      <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Job</div>

            <div className="col" style={{ gap: 12 }}>
              {/* 1 - Calendar job selector: lead with the job (the common case);
                  the date is tucked below and defaults to today. */}
              <div className="col">
                <div className="microLabel" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>Select Job{" "}
                    <span className="small" style={{ marginLeft: 4 }}>
                      {calLoading ? "Loading…" : calEvents.length > 0 ? `(${calEvents.length} found)` : calLoaded ? "(none found)" : ""}
                    </span>
                  </span>
                  <BetaTag feature="manualJobsCrossDevice" style={{ marginTop: 0 }} />
                </div>
                <select
                  value={calSelectedId}
                  onChange={(e) => onSelectCalendarEvent(e.target.value)}
                  disabled={calLoading}
                  style={{ ...selectStyle, cursor: calLoading ? "not-allowed" : "pointer" }}
                >
                  <option value="" style={optionStyle}>{calPlaceholder}</option>
                  {calEvents.map((ev) => (
                    <option key={ev.id} value={ev.id} style={optionStyle}>
                      {ev.summary}
                    </option>
                  ))}
                  {manualCalEntries.map((entry) => (
                    <option key={entry.id} value={entry.id} style={optionStyle}>
                      {entry.summary}
                    </option>
                  ))}
                  <option value="__other__" style={optionStyle}>
                    Other (enter manually)
                  </option>
                </select>

                {calSelectedId === "__other__" && (
                  <div className="col" style={{ marginTop: 8 }}>
                    <div className="microLabel">Job description (required)</div>
                    <input
                      value={calOtherName}
                      onChange={(e) => {
                        setCalOtherName(e.target.value);
                        setJobName(e.target.value);
                      }}
                      onBlur={confirmManualEntry}
                      placeholder={ht.jobDescriptionPlaceholder}
                      autoFocus
                    />
                  </div>
                )}

                {calError && <div className="small" style={{ color: "var(--danger)", marginTop: 4 }}>{calError}</div>}
                {calWarning && <div className="small" style={{ marginTop: 4 }}>{calWarning}</div>}

                {!calLoading && calLoaded && calEvents.length === 0 ? (
                  <div className="small" style={{ marginTop: 6 }}>
                    No calendar jobs on this date.
                  </div>
                ) : null}
              </div>

              {/* 2 - Date (secondary): defaults to today; change it to see another
                  day's calendar jobs. */}
              <div className="col">
                <div className="microLabel">Date</div>
                <input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
              </div>

              {/* 3 - Job name + short id (condensed - the full id is technical
                  clutter; a short prefix is enough to eyeball). */}
              {jobName && (
                <div className="col" style={{ gap: 2 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, wordBreak: "break-word" }}>{jobName}</div>
                  {jobUuid && (
                    <div className="mono" style={{ color: "var(--muted)", fontSize: 10 }} title={jobUuid}>#{jobUuid.slice(0, 8)}</div>
                  )}
                </div>
              )}

              {status && <div className="small" style={{ color: "var(--brand)" }}>{status}</div>}
              {historyStatus && <div className="small" style={{ color: "var(--muted)" }}>{historyStatus}</div>}
            </div>

            {/* Calendar context (folded into the Job tile): location + a
                collapsible details block. The event's job name and invitee
                "Crew" count are dropped here as redundant with the Job Name
                above and Set up job's real crew list below. */}
            {(() => {
              const ev = calEvents.find((e) => e.id === calSelectedId);
              if (!ev) return null;
              const loc = (ev.location || "").trim();
              const desc = calText(ev.description);
              if (!loc && !desc) return null;
              return (
                <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14 }}>
                  {loc && (
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <div className="microLabel">Location</div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 13, color: "var(--brand2)", textDecoration: "none", wordBreak: "break-word" }}
                      >
                        {loc}
                      </a>
                    </div>
                  )}
                  {desc && (
                    <div style={{ marginTop: loc ? 12 : 0 }}>
                      <button
                        type="button"
                        onClick={() => setShowJobDetails((v) => !v)}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                      >
                        <span className="microLabel" style={{ marginBottom: 0 }}>Details</span>
                        <span className="small" style={{ color: "var(--brand2)" }}>{showJobDetails ? "Hide" : "Show"}</span>
                      </button>
                      {showJobDetails && (
                        <div className="small" style={{ color: "var(--text)", whiteSpace: "pre-wrap", lineHeight: 1.5, marginTop: 6 }}>{desc}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Set up job (ADR 0034), embedded in the Job tile and collapsed by
                default - one tile for the whole job: selector, identity,
                context, and setup. */}
            {jobUuid && (() => {
              const jm = loadJobMeta(jobUuid);
              const src = jm?.source === "calendar" || jm?.source === "manual" ? jm.source : null;
              return (
                <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 14 }}>
                  <JobSetupPanel
                    key={jobUuid}
                    jobUuid={jobUuid}
                    meta={{
                      jobName: jm?.jobName || jobName || "",
                      jobDate: jm?.jobDate || jobDate || "",
                      source: src,
                      calendarEventId: jm?.calendarEventId || calSelectedId || null,
                    }}
                    onHeader={(h) => {
                      // The job header owns local/long-distance now; selecting or
                      // saving a job sets the mode from it, and a no-header job
                      // resets to local so the prior job's flag never carries over.
                      setPersistedMode(h?.is_long_distance ? "long_distance" : "local");
                    }}
                    ldPlan={ldPlan}
                    onToggleActivity={ldToggleActivity}
                  />
                </div>
              );
            })()}
          </div>

          {/* Job checklist (C3): applicable items for this job, auto-checked
              from in-app signals + manual ticks. */}
          {jobUuid && <JobChecklistCard key={jobUuid} jobUuid={jobUuid} longDistance={longDistance} />}

          {(() => {
            // Loaded weights logged for this job - visible to anyone, any time
            // (B4). Newest first. The timeline carries the full history; this is
            // the at-a-glance summary.
            const weights = [...mergedLog].filter((e) => e.type === "WEIGHT")
              .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
            if (weights.length === 0) return null;
            return (
              <div className="card">
                <div className="microLabel" style={{ marginBottom: 10 }}>Loaded weights</div>
                <div className="col" style={{ gap: 6 }}>
                  {weights.map((e) => (
                    <div key={e.event_id} className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{e.note}</span>
                      <span className="small mono" style={{ color: "var(--muted)", textAlign: "right" }}>
                        {e.timestamp ? new Date(e.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                        {e.created_by ? ` · ${e.created_by}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {(() => {
            const coreActions = (
              <>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => recordEvent("ARRIVE")}>
                  {sendingType === "ARRIVE" ? "..." : "Arrive"}
                </button>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => recordEvent("DEPART")}>
                  {sendingType === "DEPART" ? "..." : "Depart"}
                </button>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => setDvirPending({ type: "START" })}>
                  {sendingType === "START" ? "..." : "Start"}
                </button>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={() => setDvirPending({ type: "FINISH" })}>
                  {sendingType === "FINISH" ? "..." : "Finish"}
                </button>
              </>
            );
            const noteButton = (
              <button
                disabled={!canSend || sendingType !== null}
                onClick={async () => {
                  const text = window.prompt("Note:", "");
                  if (!text || !text.trim()) return;
                  await recordEvent("NOTE", text.trim());
                }}
              >
                {sendingType === "NOTE" ? "..." : "Note"}
              </button>
            );
            const weightButton = (
              <button
                disabled={!canSend || sendingType !== null}
                onClick={() => setShowWeightEntry((v) => !v)}
                title="Record a loaded / scale weight for this job"
              >
                {showWeightEntry ? "Cancel weight" : "Weight"}
              </button>
            );
            const weightEntry = showWeightEntry ? (
              <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
                <input
                  type="number"
                  inputMode="numeric"
                  value={weightVal}
                  onChange={(e) => setWeightVal(e.target.value)}
                  placeholder="Loaded weight (lb)"
                  style={{ flex: "1 1 130px", minWidth: 0 }}
                  autoFocus
                />
                <select value={weightUnit} onChange={(e) => setWeightUnit(e.target.value)} style={{ flex: "0 1 140px" }}>
                  <option value="">Unit (optional)</option>
                  {vehUnits.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                </select>
                <button className="btnPrimary" disabled={!canSend || sendingType !== null} onClick={logWeight}>
                  {sendingType === "WEIGHT" ? "..." : "Log weight"}
                </button>
              </div>
            ) : null;
            // Drive-only LD day: the RODS duty logger replaces the Actions tile.
            if (longDistance && ldDriving && ldLabor.length === 0) {
              return <RodsRecorder events={mergedLog} onLogEvent={recordEvent} />;
            }
            // Mixed LD day (driving + labor): RODS + Actions as two labeled
            // subsections in one flow, sharing a single Note button (RODS's).
            if (longDistance && ldDriving && ldLabor.length > 0) {
              return (
                <RodsRecorder
                  events={mergedLog}
                  onLogEvent={recordEvent}
                  actionsSlot={
                    <>
                      <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
                        Use these for your labor: Arrive / Start / Finish / Depart / Note. Driving is recorded by the RODS above.
                      </div>
                      <div className="row wrap">{coreActions}{weightButton}</div>
                      {weightEntry}
                    </>
                  }
                />
              );
            }
            // Local, or LD labor-only day: the normal Actions tile.
            if (!longDistance || ldLabor.length > 0) {
              return (
                <div className="card" data-component="TimelineActionsTile">
                  <div className="microLabel" style={{ marginBottom: 10 }}>Actions</div>
                  {longDistance && (
                    <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
                      Use these for your labor: Arrive / Start / Finish / Depart / Note. Driving is handled by the RODS on drive days.
                    </div>
                  )}
                  <div className="row wrap">{coreActions}{noteButton}{weightButton}</div>
                  {weightEntry}
                </div>
              );
            }
            return null;
          })()}

      {/* Home: the action-tile grid. Drilled into a task: a back-to-actions bar. */}
      {tab === "home" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 8, marginTop: 12 }}>
          {([
            { key: "timeline", label: "Timeline", icon: HubIcons.timeline },
            { key: "photos", label: "Photos", icon: HubIcons.photos },
            ...(longDistance ? [{ key: "inventory", label: "Inventory", icon: HubIcons.box }] : []),
            { key: "report", label: "Report", icon: HubIcons.report },
          ] as { key: Tab; label: string; icon: () => ReactNode }[]).map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 68, padding: "10px 6px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", cursor: "pointer" }}>
                <span style={{ color: "var(--muted)", display: "inline-flex" }}><Icon /></span>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t.label}</span>
              </button>
            );
          })}
          {/* DVIR is in the persistent bottom nav; its hub Actions tile was
              removed as redundant with that. */}
        </div>
      ) : (
        <button type="button" onClick={() => setTab("home")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 14, fontWeight: 600, padding: "6px 0" }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>&lsaquo;</span> Actions
        </button>
      )}

      {/* Timeline detail (Notes + Activity): the "Timeline" drill-in task. */}
      {tab === "timeline" && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <div className="microLabel" style={{ marginBottom: 10 }}>Notes</div>
              {jobUuid.trim() ? (
                <span
                  className="small"
                  aria-live="polite"
                  style={{
                    color:
                      notesStatus === "saved"
                        ? "var(--ok)"
                        : notesStatus === "offline"
                          ? "var(--brand2)"
                          : "var(--muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {notesStatus === "saving" && "Saving…"}
                  {notesStatus === "saved" && "✓ Saved"}
                  {notesStatus === "offline" && "Saved offline - will sync"}
                </span>
              ) : null}
            </div>
            <textarea
              value={jobComments}
              onChange={(e) => setJobComments(e.target.value)}
              placeholder={ht.jobNotesPlaceholder}
              disabled={!jobUuid.trim()}
            />
          </div>

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Activity</div>

            {mergedLog.length === 0 ? (
              <div className="small">{jobUuid ? "No events yet." : "Select a job to see activity."}</div>
            ) : (
              <div>
                {mergedLog.map((e, i) => (
                  <div
                    key={e.event_id}
                    style={{
                      padding: "10px 0",
                      borderTop: i > 0 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                        <span
                          className="statusDot"
                          style={{
                            ["--dot" as any]: e.sync_status === "synced" ? "var(--ok)" : "var(--brand2)",
                            fontSize: 11,
                          }}
                        >
                          {e.sync_status === "synced" ? "Synced" : "Queued"}
                        </span>
                        <strong style={{ fontSize: 14 }}>{e.type === "WEIGHT" ? "Loaded weight" : e.type}</strong>
                        {e.created_by && (
                          <span className="row" style={{ gap: 6, minWidth: 0 }}>
                            <UserAvatar displayName={e.created_by} size={18} />
                            <span
                              className="small"
                              style={{
                                color: "var(--muted)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                maxWidth: 180,
                              }}
                            >
                              {e.created_by}
                            </span>
                          </span>
                        )}
                      </div>
                      {/* Time + date - wrap independently so the date can
                          drop to its own line on narrow phones instead of
                          running off the tile. Tap the time to edit it;
                          logged_at is preserved separately as the audit
                          trail. */}
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {e.lat != null && (
                          <span className="small" style={{ whiteSpace: "nowrap" }}>
                            ±{Math.round(e.accuracy_m ?? 0)}m
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTimeError(null);
                            setEditingTimeFor((prev) => (prev === e.event_id ? null : e.event_id));
                          }}
                          title="Tap to edit the event time"
                          style={{
                            background: "transparent",
                            border: "none",
                            padding: 0,
                            color: "var(--muted)",
                            cursor: "pointer",
                            fontSize: 13,
                            whiteSpace: "nowrap",
                            textDecoration: "underline dotted",
                            textDecorationColor: "var(--border)",
                            textUnderlineOffset: 3,
                          }}
                        >
                          {formatMountainTime(e.timestamp)}
                        </button>
                        <span className="small" style={{ whiteSpace: "nowrap" }}>
                          {formatMountainDate(e.timestamp)}
                        </span>
                      </div>
                    </div>

                    {editingTimeFor === e.event_id && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <label className="small" style={{ color: "var(--muted)" }}>
                          Edit event time
                        </label>
                        <input
                          type="time"
                          defaultValue={toTimeValue(e.timestamp)}
                          onChange={() => setEditingTimeError(null)}
                          id={`time-edit-${e.event_id}`}
                          style={{
                            padding: "8px 10px",
                            fontSize: 14,
                            borderRadius: "var(--btn-r)",
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.05)",
                            color: "var(--text)",
                          }}
                        />
                        {editingTimeError && (
                          <div className="small" style={{ color: "var(--danger)" }}>
                            {editingTimeError}
                          </div>
                        )}
                        <div className="small" style={{ color: "var(--muted)" }}>
                          Originally logged{" "}
                          {formatMountain(e.logged_at ?? e.timestamp, {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}.
                        </div>
                        <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Delete this event? This can't be undone.")) {
                                deleteEvent(e.event_id);
                                setEditingTimeFor(null);
                                setEditingTimeError(null);
                              }
                            }}
                            style={{
                              fontSize: 12,
                              padding: "6px 12px",
                              background: "transparent",
                              border: "1px solid var(--danger)",
                              color: "var(--danger)",
                              borderRadius: 6,
                              cursor: "pointer",
                            }}
                          >
                            Delete
                          </button>
                          <div className="row" style={{ gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTimeFor(null);
                              setEditingTimeError(null);
                            }}
                            style={{
                              fontSize: 12,
                              padding: "6px 12px",
                              background: "transparent",
                              border: "1px solid var(--border)",
                              color: "var(--muted)",
                              borderRadius: 6,
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const inputEl = document.getElementById(
                                `time-edit-${e.event_id}`,
                              ) as HTMLInputElement | null;
                              const localVal = inputEl?.value ?? "";
                              const iso = applyTimeToIso(localVal, e.timestamp);
                              if (!iso) {
                                setEditingTimeError("Pick a valid time.");
                                return;
                              }
                              const reason = validateEditableTimestamp(iso, e.logged_at);
                              if (reason) {
                                setEditingTimeError(reason);
                                return;
                              }
                              updateEventTime(e.event_id, iso);
                              setEditingTimeFor(null);
                              setEditingTimeError(null);
                            }}
                            className="btnPrimary"
                            style={{ fontSize: 12, padding: "6px 12px" }}
                          >
                            Save
                          </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div
                      className="row"
                      style={{
                        marginTop: 5,
                        gap: 8,
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                      }}
                    >
                      {e.note ? (
                        <div
                          className="small"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontStyle: "italic",
                            color: "var(--muted)",
                            wordBreak: "break-word",
                          }}
                        >
                          "{e.note}"
                        </div>
                      ) : <span style={{ flex: 1 }} />}
                      <button
                        type="button"
                        onClick={() => {
                          const text = window.prompt(
                            e.note ? "Edit note:" : "Attach a note to this event:",
                            e.note ?? "",
                          );
                          if (text === null) return; // cancelled
                          updateEventNote(e.event_id, text);
                        }}
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                          borderRadius: 6,
                          flexShrink: 0,
                          cursor: "pointer",
                        }}
                        title={e.note ? "Edit note for this event" : "Add a note to this event"}
                      >
                        {e.note ? "✎ note" : "+ note"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </>
      )}

      {/* Photos */}
      {tab === "photos" && (
        <>
          {/* Incident reporting lives on the Photos tab so crew document an
              incident and attach photos to its claim in one place. */}
          {jobUuid ? (
            <IncidentReport
              jobUuid={jobUuid}
              jobName={jobName}
              jobDate={jobDate}
              onIncidentsChange={setJobIncidents}
              onReported={(ref) => { setAttachIncidentUuid(ref.incident_uuid); setTab("photos"); }}
              photoCounts={incidentPhotoCounts}
            />
          ) : (
            <div className="card">
              <div className="small" style={{ color: "var(--muted)" }}>
                Select a job on the Timeline tab to report an incident or add photos.
              </div>
            </div>
          )}

          {/* Capture: take one at a time and/or multi-select from the library,
              accumulating a batch before submitting. */}
          <div className="card">
            <div className="microLabel" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Photos<BetaTag feature="multiPhoto" />
            </div>
            {ht.photosHint && (
              <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>
                {ht.photosHint}
              </div>
            )}
            <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
              Take several photos (each adds to the batch) or pick multiple from your library, then save them together. Add a note per photo before or after saving.
            </div>
            <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
              <label className="btnPrimary" style={{ cursor: photoBusy ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)" }}>
                {photoBusy ? "Working…" : "Take Photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                  disabled={photoBusy}
                  onChange={(e) => { onAddPhotoFiles(e.target.files); e.currentTarget.value = ""; }}
                />
              </label>
              <label style={{ cursor: photoBusy ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)", border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)" }}>
                Add from Library
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  disabled={photoBusy}
                  onChange={(e) => { onAddPhotoFiles(e.target.files); e.currentTarget.value = ""; }}
                />
              </label>
              <button onClick={refreshPhotos} disabled={photoBusy}>Refresh</button>
            </div>
            {photoError && (
              <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{photoError}</div>
            )}
          </div>

          {/* Pending batch - review, note each photo, then submit together. */}
          {pendingPhotos.length > 0 && (
            <div className="card">
              <div className="microLabel" style={{ marginBottom: 10 }}>Ready to save ({pendingPhotos.length})</div>

              {/* Attach target: tag this batch to an incident's claim, or leave
                  as plain job photos. Only shown when the job has incidents. */}
              {jobIncidents.length > 0 && (
                <div className="col" style={{ gap: 6, marginTop: 8 }}>
                  <span className="small" style={{ color: "var(--muted)" }}>Attach these photos to</span>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {[{ incident_uuid: "", claim_number: "", severity: "", description: "The job (not an incident)" } as JobIncidentRef, ...jobIncidents].map((inc) => {
                      const on = attachIncidentUuid === inc.incident_uuid;
                      const label = inc.incident_uuid
                        ? (inc.claim_number || "Incident")
                        : "The job";
                      return (
                        <button key={inc.incident_uuid || "__job__"} type="button"
                          onClick={() => setAttachIncidentUuid(inc.incident_uuid)}
                          title={inc.description}
                          style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                            border: on ? "2px solid var(--brand)" : "1px solid var(--border)",
                            background: on ? "color-mix(in srgb, var(--brand) 18%, transparent)" : "transparent",
                            color: on ? "var(--brand)" : "var(--text)", fontWeight: on ? 700 : 400 }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="col" style={{ gap: 12, marginTop: 8 }}>
                {pendingPhotos.map((p) => {
                  const url = URL.createObjectURL(p.file);
                  return (
                    <div key={p.id} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
                      <img src={url} alt="preview" style={{ width: "100%", display: "block" }} onLoad={() => URL.revokeObjectURL(url)} />
                      <div className="col" style={{ gap: 6, padding: 10 }}>
                        <div className="label">Note (optional)</div>
                        <textarea
                          value={p.caption}
                          onChange={(e) => setPendingCaptionFor(p.id, e.target.value)}
                          placeholder={ht.photoCaptionPlaceholder}
                          rows={2}
                        />
                        <button
                          onClick={() => removePendingPhoto(p.id)}
                          disabled={photoBusy}
                          style={{ alignSelf: "flex-start", fontSize: 12, padding: "4px 10px" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                <button className="btnPrimary" onClick={onSaveAllPending} disabled={photoBusy}>
                  {photoBusy ? "Saving…" : (pendingPhotos.length === 1 ? "Save Photo" : `Save All (${pendingPhotos.length})`)}
                </button>
                <button onClick={() => setPendingPhotos([])} disabled={photoBusy}>Clear</button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="microLabel" style={{ marginBottom: 10 }}>Saved</div>

            {photos.length === 0 && serverPhotos.filter(sp => !photos.some(lp => lp.id === sp.id)).length === 0 ? (
              <div className="small">{jobUuid ? "No photos yet." : "Select a job to see photos."}</div>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                {photos.map((p) => {
                  const url = previewUrls[p.id];
                  const driveOk = p.drive_status === "uploaded";
                  const driveFail = p.drive_status === "failed";
                  return (
                    <div
                      key={p.id}
                      style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)" }}
                    >
                      {/* Do NOT revoke onLoad: the URL is owned by the previewUrls
                          effect, which revokes it when the photo set changes. Revoking
                          here killed a URL still held as src, and nothing re-minted it,
                          so the thumbnail broke permanently once iOS evicted the decoded
                          image (backgrounded tab / memory pressure). url is undefined
                          for a photo whose bytes are unreadable - show a placeholder
                          rather than a broken-image icon. */}
                      {url ? (
                        <img
                          src={url}
                          alt={p.caption || "job photo"}
                          style={{ width: "100%", display: "block" }}
                        />
                      ) : (
                        <div className="small" style={{ padding: 16, color: "var(--muted)", textAlign: "center" }}>
                          Preview unavailable on this device
                        </div>
                      )}
                      <div style={{ padding: 10 }}>
                        {editingNoteId === p.id ? (
                          <div className="col" style={{ gap: 6, marginBottom: 8 }}>
                            <textarea
                              value={noteDraft}
                              onChange={(e) => setNoteDraft(e.target.value)}
                              placeholder={ht.photoCaptionPlaceholder}
                              rows={2}
                              autoFocus
                            />
                            <div className="row wrap" style={{ gap: 6 }}>
                              <button className="btnPrimary" disabled={photoBusy}
                                onClick={() => onSaveNote(p.id, noteDraft.trim(), true)}
                                style={{ fontSize: 12, padding: "4px 10px" }}>
                                Save note
                              </button>
                              <button onClick={() => { setEditingNoteId(null); setNoteDraft(""); }}
                                style={{ fontSize: 12, padding: "4px 10px" }}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          p.caption && <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.caption}</div>
                        )}
                        {p.claim_number && (
                          <div style={{ display: "inline-block", marginBottom: 6, fontSize: 11, fontWeight: 700, color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
                            Incident {p.claim_number}
                          </div>
                        )}
                        <div className="small" style={{ color: "var(--muted)" }}>{formatMountainDateTime(p.created_at)}</div>
                        <div className="row wrap" style={{ marginTop: 8, gap: 6, alignItems: "center" }}>
                          {editingNoteId !== p.id && (
                            <button onClick={() => { setEditingNoteId(p.id); setNoteDraft(p.caption || ""); }}
                              disabled={photoBusy}
                              style={{ fontSize: 12, padding: "4px 10px" }}>
                              {p.caption ? "Edit note" : "Add note"}
                            </button>
                          )}
                          {driveOk && p.drive_url ? (
                            <a href={p.drive_url} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: "var(--ok)", textDecoration: "none", border: "1px solid color-mix(in srgb, var(--ok) 30%, transparent)", padding: "2px 8px", borderRadius: 999 }}>
                              View in Drive
                            </a>
                          ) : driveFail ? (
                            <>
                              <span style={{ fontSize: 11, color: "var(--danger)" }} title={p.drive_error}>
                                Drive upload failed{p.drive_error ? ` - ${p.drive_error}` : ""}
                              </span>
                              <button onClick={() => onRetryPhotoUpload(p)} disabled={photoBusy}
                                style={{ fontSize: 11, padding: "2px 8px" }}>
                                Retry
                              </button>
                            </>
                          ) : p.drive_status === "pending" ? (
                            <>
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>Uploading…</span>
                              <button onClick={() => onRetryPhotoUpload(p)} disabled={photoBusy}
                                style={{ fontSize: 11, padding: "2px 8px" }}>
                                Retry
                              </button>
                            </>
                          ) : null}
                          <button onClick={() => onDeletePhoto(p.id)} disabled={photoBusy}
                            style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Photos from other devices (server-only) */}
                {serverPhotos.filter(sp => !photos.some(lp => lp.id === sp.id)).map((sp) => (
                  <div key={sp.id} style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)" }}>
                    <img
                      src={sp.thumb_url}
                      alt={sp.caption || "job photo"}
                      style={{ width: "100%", display: "block" }}
                    />
                    <div style={{ padding: 10 }}>
                      {editingNoteId === sp.id ? (
                        <div className="col" style={{ gap: 6, marginBottom: 8 }}>
                          <textarea
                            value={noteDraft}
                            onChange={(e) => setNoteDraft(e.target.value)}
                            placeholder={ht.photoCaptionPlaceholder}
                            rows={2}
                            autoFocus
                          />
                          <div className="row wrap" style={{ gap: 6 }}>
                            <button className="btnPrimary" disabled={photoBusy}
                              onClick={() => onSaveNote(sp.id, noteDraft.trim(), false)}
                              style={{ fontSize: 12, padding: "4px 10px" }}>
                              Save note
                            </button>
                            <button onClick={() => { setEditingNoteId(null); setNoteDraft(""); }}
                              style={{ fontSize: 12, padding: "4px 10px" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        sp.caption && <div style={{ fontWeight: 600, marginBottom: 6 }}>{sp.caption}</div>
                      )}
                      {sp.claim_number && (
                        <div style={{ display: "inline-block", marginBottom: 6, fontSize: 11, fontWeight: 700, color: "var(--brand)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px" }}>
                          Incident {sp.claim_number}
                        </div>
                      )}
                      <div className="small" style={{ color: "var(--muted)" }}>{formatMountainDateTime(sp.created_at)}</div>
                      {sp.created_by && (
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          <UserAvatar displayName={sp.created_by} size={18} />
                          <span className="small" style={{ color: "var(--muted)" }}>by {sp.created_by}</span>
                        </div>
                      )}
                      <div className="row wrap" style={{ marginTop: 8, gap: 6, alignItems: "center" }}>
                        {editingNoteId !== sp.id && (
                          <button onClick={() => { setEditingNoteId(sp.id); setNoteDraft(sp.caption || ""); }}
                            disabled={photoBusy}
                            style={{ fontSize: 12, padding: "4px 10px" }}>
                            {sp.caption ? "Edit note" : "Add note"}
                          </button>
                        )}
                        <a href={sp.drive_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "var(--ok)", textDecoration: "none", border: "1px solid color-mix(in srgb, var(--ok) 30%, transparent)", padding: "2px 8px", borderRadius: 999 }}>
                          View in Drive
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Inventory: actual inventory + BOL packing inventory (LD load days).
          Long-distance only - see the tab button above. */}
      {tab === "inventory" && longDistance && (
        jobUuid ? (
          <>
            <ActualInventory jobUuid={jobUuid} jobName={jobName} jobDate={jobDate} />
            {longDistance && ldLabor.includes("loading") && (
              <BolInventoryTab jobUuid={jobUuid} jobName={jobName} jobDate={jobDate} />
            )}
          </>
        ) : (
          <div className="card">
            <div className="small" style={{ color: "var(--muted)" }}>
              Select a job on the Timeline tab before adding inventory.
            </div>
          </div>
        )
      )}

      {/* Report */}
      {tab === "report" && (
        <JobReport jobUuid={jobUuid} jobName={jobName} events={mergedLog} longDistance={longDistance} driveOnly={longDistance && ldDriving && ldLabor.length === 0} mixedLd={longDistance && ldDriving && ldLabor.length > 0} />
      )}

      {/* DVIR reminder modal - shown before START or FINISH */}
      {dvirPending && (
        <DVIRReminderModal
          trigger={dvirPending.type === "START" ? "pre-trip" : "post-trip"}
          onProceed={() => {
            const type = dvirPending.type;
            setDvirPending(null);
            recordEvent(type);
          }}
          onCancel={() => setDvirPending(null)}
        />
      )}

    </div>
  );
}
