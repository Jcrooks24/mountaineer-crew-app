import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { apiFetch } from "./api/client";
import JobReport from "./components/JobReport";
import DVIRReminderModal from "./components/DVIRReminderModal";
import UserAvatar from "./components/UserAvatar";
import { ensureDirectory } from "./lib/userDirectory";
import { addPhoto, deletePhoto, listPhotosForJob, updatePhoto, type StoredPhoto } from "./lib/photoStore";
import { useTheme, useResolvedLogo } from "./theme/ThemeContext";
import { hasUnseenPatchNotes } from "./lib/patchNotesSeen";
import AdminNotesBanner from "./components/AdminNotesBanner";
import { getToken } from "./auth/token";
import {
  renderedForJob as materialsRenderedForJob,
  syncQueue as syncMaterialsQueue,
  fetchAndCache as fetchAndCacheMaterials,
  type LiveMaterial,
} from "./lib/materialsStore";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// Resize + compress a photo before upload so Render stays under its 512MB memory limit.
// Caps the longest side at 1920px and encodes as JPEG at 80% quality.
// Typical mobile photo: 8MB → ~600KB after this.
async function resizeImage(file: File | Blob, maxPx = 1920, quality = 0.8): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
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

// Retention — the Google Sheet is the long-term record; the client log is a
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
const COMMENTS_PREFIX = "crew_job_comments_v1:"; // per job_uuid

// Per-job metadata (existing)
const JOB_NAME_PREFIX = "crew_job_name_v1:"; // per job_uuid
const JOB_DATE_PREFIX = "crew_job_date_v1:"; // per job_uuid

// NEW: job meta + calendar binding (fixes "events under wrong job name")
const JOB_META_PREFIX = "crew_job_meta_v1:"; // per job_uuid
const CAL_BIND_PREFIX = "crew_cal_bind_v1:"; // per date+calendarEventId => job_uuid

type Tab = "timeline" | "photos" | "report";

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
// in place — the shape is a strict superset.
type EventPatchOp = {
  event_id: string;
  note?: string | null;
  timestamp?: string;
  enqueued_at: string;
};

type CalEvent = {
  id: string;
  summary: string;
  start?: string;
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
};

// `<input type="time">` round-tripping. The element's value is "HH:mm" in
// the user's local time. We keep the event's existing date intact and only
// rewrite hours/minutes — crew typically just need to nudge minutes within
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

// Mirrors the server-side bounds in /api/events PATCH. Returns null when
// valid, or a short reason when the user picked an invalid time.
function validateEditableTimestamp(newIso: string, loggedAtIso: string | undefined): string | null {
  const newT = Date.parse(newIso);
  if (!Number.isFinite(newT)) return "Invalid date.";
  const now = Date.now();
  if (newT - now > 5 * 60 * 1000) return "Time can't be in the future.";
  const baseline = loggedAtIso ? Date.parse(loggedAtIso) : now;
  const earliest = (Number.isFinite(baseline) ? baseline : now) - 7 * 24 * 60 * 60 * 1000;
  if (newT < earliest) return "Time can't be more than 7 days before the event was logged.";
  return null;
}

function todayLocalYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

/**
 * Derive a deterministic UUID v4 from a Google Calendar event ID.
 * Any device calling this with the same calId gets the same UUID,
 * so all crew members on the same job share a single job_uuid.
 */
function calEventToJobUuid(calId: string): string {
  // FNV-1a 32-bit with different seeds to produce 128 bits total
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

export default function App() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { settings: themeSettings } = useTheme();
  const { src: logo, variant: logoVariant } = useResolvedLogo();
  const ht = themeSettings.helpTexts;
  const [tab, setTab] = useState<Tab>("timeline");

  const [jobUuid, setJobUuid] = useState<string>(() => localStorage.getItem(JOB_KEY) || "");
  const [jobStatus, setJobStatus] = useState<"active" | "closed">(
    () => (localStorage.getItem(JOB_STATUS_KEY) as any) || "active"
  );

  const [status, setStatus] = useState<string>("");


  const [queueLen, setQueueLen] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<EventRecord[]>([]);

  const [clockText, setClockText] = useState<string>("—");
  const [patchNotesUnseen, setPatchNotesUnseen] = useState<boolean>(false);

  useEffect(() => {
    apiFetch<{ id: number; updated_at: string }[]>("/api/patch-notes")
      .then((rows) => {
        const latest = rows[0]?.updated_at ?? null;
        setPatchNotesUnseen(hasUnseenPatchNotes(latest));
      })
      .catch(() => {/* non-fatal — no indicator */});
  }, []);

  // Retention prune on boot — drop stale log entries and stuck queue ops
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
      /* corrupted JSON — ignore; next write will overwrite */
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
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>("");
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingCaption, setPendingCaption] = useState<string>("");

  const [sendingType, setSendingType] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [dvirPending, setDvirPending] = useState<{ type: string } | null>(null);
  const [serverEvents, setServerEvents] = useState<EventRecord[]>([]);
  const [serverPhotos, setServerPhotos] = useState<ServerPhoto[]>([]);
  const [materialsSummary, setMaterialsSummary] = useState<LiveMaterial[]>([]);
  // event_id of the timeline row whose timestamp is currently being edited.
  // null when nothing is open. Only one row can edit at a time.
  const [editingTimeFor, setEditingTimeFor] = useState<string | null>(null);
  const [editingTimeError, setEditingTimeError] = useState<string | null>(null);

  const canSend = useMemo(() => jobUuid.trim().length > 0, [jobUuid]);

  const [historyStatus, setHistoryStatus] = useState<string>("");

  // Calendar "Other" option
  const [calOtherName, setCalOtherName] = useState<string>("");
  // Manual job entries created this session — shown as dropdown options so
  // users can re-select them without re-typing. Persisted to sessionStorage
  // so they survive navigation within the same tab.
  const [manualCalEntries, setManualCalEntries] = useState<{ id: string; summary: string }[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("crew_session_manualEntries") || "[]"); }
    catch { return []; }
  });


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
      // Quota exceeded or similar — surface once so the problem isn't silent.
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
    // Defensive cap — saveLog is called from many paths; enforce the ceiling
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

  function iconForStatus(s: "queued" | "synced") {
    return s === "synced" ? "✓" : "●";
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
    if (!uuid) return "—";

    const jobLog = log.filter((e) => e.job_uuid === uuid);

    const start = jobLog
      .filter((e) => e.type === "START")
      .map((e) => Date.parse(e.timestamp))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b)[0];

    if (!Number.isFinite(start)) return "—";

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
        // 4xx that's specifically about a malformed timestamp is permanent —
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
    // note in-place — it will ride the normal sync and the server will insert
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
        created_by: user?.name || user?.email || "",
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

      // Any event that arrived at the server has been "handled" — either
      // inserted, deduped, or permanently rejected. Retrying rejected events
      // just wedges the queue forever. So: if we got any well-formed
      // response back, drop the whole batch and warn on the failures.
      // Only keep the queue when the HTTP request itself errored (catch).
      if (json?.ok === true) {
        const failed: { event_id: string; reason?: string }[] = json.failed ?? [];
        const ids = new Set(q.map((e) => e.event_id));
        markLogEventsSyncedByIds(ids);
        saveQueue([]);
        if (failed.length > 0) {
          console.warn(
            `[sync] server rejected ${failed.length} event(s):`,
            failed.map((f) => `${f.event_id} (${f.reason ?? "unknown"})`).join(", "),
          );
          setStatus(`Synced — ${failed.length} rejected`);
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
      // the same — both reflect the device clock at the moment of the tap.
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

  // -----------------------
  // Calendar binding
  // -----------------------
  async function loadCalendarEvents() {
    setCalError("");
    setCalWarning("");
    setCalLoading(true);
    setCalEvents([]);
    // Do NOT clear calSelectedId here — callers own that decision.
    // The date-change effect clears it before calling; the first-mount
    // guard intentionally preserves the sessionStorage-restored value.
    setCalLoaded(false);

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

  // Called on blur of the manual-entry input. Promotes the typed name from
  // the hidden "__other__" sentinel to a real named dropdown option so the
  // user can re-select this job without re-typing the description.
  function confirmManualEntry() {
    const name = calOtherName.trim();
    if (!name || !jobUuid) return;
    const entry = { id: jobUuid, summary: name };
    setManualCalEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === jobUuid);
      const next = idx >= 0 ? prev.map((e, i) => (i === idx ? entry : e)) : [...prev, entry];
      sessionStorage.setItem("crew_session_manualEntries", JSON.stringify(next));
      return next;
    });
    setCalSelectedId(jobUuid); // switch dropdown value to the real UUID
  }

  async function onSelectCalendarEvent(calId: string) {
    setCalSelectedId(calId);

    if (calId === "__other__") {
      const newUuid = crypto.randomUUID();
      setCalOtherName("");
      setPersistedJobUuid(newUuid);
      setPersistedJobStatus("active");
      setJobName("");
      setStatus("Manual job — enter description below");
      fetchJobEvents(newUuid);
      fetchServerPhotos(newUuid);
      return;
    }

    // Re-selecting a previously confirmed manual entry — restore same UUID + name.
    const manualEntry = manualCalEntries.find((e) => e.id === calId);
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
      const res = await fetch(`${API}/api/jobs/resolve?calendar_event_id=${encodeURIComponent(calId)}`, {
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
            jobDate: e.timestamp.slice(0, 10),
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
      // offline or error — server events unavailable, local queue still shown
    }
  }

  async function fetchServerPhotos(uuid: string) {
    if (!uuid.trim()) return;
    try {
      const data = await apiFetch<{ ok: boolean; photos: ServerPhoto[] }>(`/api/photos?job_uuid=${encodeURIComponent(uuid)}`);
      if (data?.photos) setServerPhotos(data.photos);
    } catch {
      // offline — server photos unavailable
    }
  }

  // -----------------------
  // Photos
  // -----------------------
  async function refreshPhotos() {
    try {
      setPhotoError("");
      const list = await listPhotosForJob(jobUuid.trim());
      setPhotos(list);
    } catch (e: any) {
      setPhotoError(e?.message ?? "Could not load photos");
    }
  }

  function onPickPhotoFile(file: File | null) {
    if (!file) return;
    if (!jobUuid.trim()) { setPhotoError("Select a job first"); return; }
    setPhotoError("");
    setPendingPhotoFile(file);
    setPendingCaption("");
  }

  async function onSavePendingPhoto() {
    if (!pendingPhotoFile || !jobUuid.trim()) return;
    setPhotoBusy(true);
    setPhotoError("");

    // Capture before clearing state
    const fileRef = pendingPhotoFile;
    const photoId = crypto.randomUUID();
    const caption = pendingCaption.trim();
    const stored: StoredPhoto = {
      id: photoId,
      job_uuid: jobUuid.trim(),
      created_at: new Date().toISOString(),
      mime: fileRef.type || "image/jpeg",
      caption,
      blob: fileRef,
      drive_status: "pending",
    };

    try {
      await addPhoto(stored);
      setPendingPhotoFile(null);
      setPendingCaption("");
      await refreshPhotos();
      setStatus("Photo saved — uploading to Drive…");
    } catch (e: any) {
      setPhotoError(e?.message ?? "Photo save failed");
      setPhotoBusy(false);
      return;
    }

    // Upload to Drive (non-blocking after local save)
    try {
      const form = new FormData();
      const resized = await resizeImage(fileRef);
      form.append("file", resized, (fileRef.name || "photo.jpg").replace(/.[^.]+$/, ".jpg"));
      form.append("photo_id", photoId);
      form.append("job_uuid", jobUuid.trim());
      form.append("job_name", jobName);
      form.append("job_date", jobDate);
      form.append("caption", caption);

      const token = getToken() || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: makeAuthHeaders(token),
        body: form,
      });
      const json = await res.json();
      if (res.ok && json.drive_url) {
        await updatePhoto(photoId, { drive_status: "uploaded", drive_url: json.drive_url });
        await refreshPhotos();
        setStatus("Photo saved to Drive");
      } else {
        const errMsg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        await updatePhoto(photoId, { drive_status: "failed", drive_error: errMsg });
        await refreshPhotos();
      }
    } catch (uploadErr: any) {
      await updatePhoto(photoId, { drive_status: "failed", drive_error: uploadErr?.message ?? "Network error" });
      await refreshPhotos();
    }

    setPhotoBusy(false);
  }

  async function onRetryPhotoUpload(photo: StoredPhoto) {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoError("");
    await updatePhoto(photo.id, { drive_status: "pending", drive_error: undefined });
    await refreshPhotos();
    try {
      const form = new FormData();
      const resized = await resizeImage(photo.blob);
      form.append("file", resized, photo.id + ".jpg");
      form.append("photo_id", photo.id);
      form.append("job_uuid", photo.job_uuid);
      form.append("job_name", jobName);
      form.append("job_date", jobDate);
      form.append("caption", photo.caption);
      const token = getToken() || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: makeAuthHeaders(token),
        body: form,
      });
      const json = await res.json();
      if (res.ok && json.drive_url) {
        await updatePhoto(photo.id, { drive_status: "uploaded", drive_url: json.drive_url });
        setStatus("Photo uploaded to Drive");
      } else {
        const errMsg = json?.error ? String(json.error) : `HTTP ${res.status}`;
        await updatePhoto(photo.id, { drive_status: "failed", drive_error: errMsg });
      }
    } catch (uploadErr: any) {
      await updatePhoto(photo.id, { drive_status: "failed", drive_error: uploadErr?.message ?? "Network error" });
    }
    await refreshPhotos();
    setPhotoBusy(false);
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

  // -----------------------
  // Materials summary — read from the offline-capable materialsStore cache,
  // then fire a background sync + refetch.
  // -----------------------
  function refreshMaterialsSummary(uuid: string) {
    setMaterialsSummary(materialsRenderedForJob(uuid.trim()));
  }

  async function loadMaterialsSummary(uuid: string) {
    const trimmed = uuid.trim();
    refreshMaterialsSummary(trimmed);
    if (!trimmed) return;
    await syncMaterialsQueue();
    const ok = await fetchAndCacheMaterials(trimmed);
    if (ok) refreshMaterialsSummary(trimmed);
  }

  // -----------------------
  // Effects
  // -----------------------
  useEffect(() => {
    // Auto-load calendar for today on login
    loadCalendarEvents();
    // Load server events for any active job
    if (jobUuid.trim()) fetchJobEvents(jobUuid.trim());

    const q = loadQueue();
    setQueueLen(q.length);

    const log = loadLog();
    setActivityLog(log);

    setJobComments(loadCommentsForJob(jobUuid));

    // Rehydrate the active job's name on boot, but leave jobDate at today
    // (the useState initializer). Crews log in to work today's jobs — showing
    // last session's date in the Timeline filter was confusing.
    const meta = loadJobMeta(jobUuid);
    if (meta) {
      setJobName(meta.jobName || "");
    } else {
      setJobName(loadJobName(jobUuid));
    }

    // Restore history from backend so mobile devices aren't empty on first load
    loadHistoryFromBackend();
    loadMaterialsSummary(jobUuid);

    // Fetch the user directory so we can show crew members' profile photos in
    // activity entries and photo attributions.
    ensureDirectory().catch(() => { /* offline — fall back to initials */ });

    const onOnline = () => { setIsOnline(true); syncQueueNow(); drainNotePatchQueue(); loadMaterialsSummary(jobUuid); };
    const onOffline = () => setIsOnline(false);
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
    if (!jobUuid.trim()) return;
    saveCommentsForJob(jobUuid.trim(), jobComments);
  }, [jobUuid, jobComments]);

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
  // restoring session state — skip the clear so the restored calSelectedId
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

  // Refresh materials summary when the user returns to the Timeline tab
  // or re-focuses the window so they see other crew members' additions.
  useEffect(() => {
    if (tab !== "timeline") return;
    loadMaterialsSummary(jobUuid);
    function onVis() {
      if (document.visibilityState === "visible") loadMaterialsSummary(jobUuid);
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
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
    // All local events for this job (synced + queued, from full localStorage log)
    const localByJob = activityLog.filter((e) => e.job_uuid === uuid);
    const localIds = new Set(localByJob.map((e) => e.event_id));
    // Server events from other users not present locally
    const serverOnly = serverEvents.filter((e) => !localIds.has(e.event_id));
    return [...localByJob, ...serverOnly].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [activityLog, serverEvents, jobUuid]);

  // Aggregate totals for the current job's materials (populated from the
  // backend via loadMaterialsSummary)
  const materialsTotal = useMemo(
    () => materialsSummary.reduce((s, m) => s + (m.unitPrice == null ? 0 : m.unitPrice * m.qty), 0),
    [materialsSummary],
  );

  const calPlaceholder = useMemo(() => {
    if (calLoading) return "Loading…";
    if (!calLoaded) return "Load calendar first";
    if (calEvents.length > 0) return "Select…";
    return "No jobs found (try another date)";
  }, [calLoading, calLoaded, calEvents.length]);

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
              // Inversion is only applied to the "light" variant — the
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
            <div className="small">{clockText === "—" ? "Clock starts at Start" : `Clock: ${clockText}`}</div>
          </div>
        </div>

        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          <span className="chip" style={{ color: isOnline ? "var(--ok)" : "var(--danger)" }}>
            {isOnline ? "Online" : "Offline"}
          </span>
          <span className="chip" style={queueLen > 0 ? { color: "var(--brand2)", borderColor: "rgba(106,167,255,0.35)" } : {}}>
            Queue {queueLen}
          </span>
          <span className="chip" style={{ color: jobStatus === "active" ? "var(--ok)" : "var(--muted)", textTransform: "capitalize" }}>
            {jobStatus}
          </span>
          <button
            className="chip"
            onClick={() => nav("/dvir")}
            style={{ cursor: "pointer", background: "none", border: "1px solid rgba(255,255,255,0.3)" }}
          >
            DVIR
          </button>
          {user?.role === "admin" && (
            <button
              className="chip"
              onClick={() => nav("/admin")}
              style={{ cursor: "pointer", background: "none", border: "1px solid rgba(255,255,255,0.3)" }}
            >
              Admin
            </button>
          )}
          <button
            className="chip"
            onClick={() => { setPatchNotesUnseen(false); nav("/profile"); }}
            style={{ cursor: "pointer", background: "none", border: "1px solid rgba(255,255,255,0.3)", position: "relative" }}
          >
            Profile
            {patchNotesUnseen && (
              <span
                title="New patch notes — view on Profile"
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: "var(--brand)",
                  boxShadow: "0 0 0 2px var(--bg)",
                }}
              />
            )}
          </button>
        </div>
      </div>

      {/* Admin notes — global, then per-job when a job is selected */}
      <AdminNotesBanner scope="global" />
      {jobUuid && <AdminNotesBanner key={jobUuid} scope={jobUuid} />}

      {/* Tabs */}
      <div className="tabbar">
        <button className={"tab " + (tab === "timeline" ? "active" : "")} onClick={() => setTab("timeline")}>
          Timeline
        </button>
        <button className={"tab " + (tab === "photos" ? "active" : "")} onClick={() => setTab("photos")}>
          Photos
        </button>
        <button
          className={"tab " + (tab === "report" ? "active" : "")}
          onClick={() => setTab("report")}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.1, gap: 2 }}
        >
          <span>Report</span>
          <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>Complete at end of job</span>
        </button>
      </div>

      {/* Timeline */}
      {tab === "timeline" && (
        <>
          <div className="card">
            <div className="sectionTitle">Job</div>

            <div className="col" style={{ gap: 12 }}>
              {/* 1 — Date */}
              <div className="col">
                <div className="label">Date</div>
                <input type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} />
              </div>

              {/* 2 — Calendar job selector */}
              <div className="col">
                <div className="label">
                  Select Job{" "}
                  <span className="small" style={{ marginLeft: 8 }}>
                    {calLoading ? "Loading…" : calEvents.length > 0 ? `(${calEvents.length} found)` : calLoaded ? "(none found)" : ""}
                  </span>
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
                    <div className="label">Job description (required)</div>
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

              {/* 3 — Job name display */}
              {jobName && (
                <div className="col">
                  <div className="label">Job Name</div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{jobName}</div>
                </div>
              )}

              {/* 4 — Job ID (auto, read-only) */}
              {jobUuid && (
                <div className="col">
                  <div className="label">Job ID</div>
                  <div className="mono small" style={{ color: "var(--muted)", fontSize: 11 }}>{jobUuid}</div>
                </div>
              )}

              {status && <div className="small" style={{ color: "var(--brand)" }}>{status}</div>}
              {historyStatus && <div className="small" style={{ color: "var(--muted)" }}>{historyStatus}</div>}
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">Actions</div>

            <div className="col" style={{ gap: 10 }}>
              <div className="row wrap">
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
              </div>

              <div className="row wrap" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <button disabled={queueLen === 0} onClick={syncQueueNow}>
                  {queueLen > 0 ? `Sync (${queueLen} pending)` : "Sync"}
                </button>
                <button
                  disabled={!jobUuid.trim() || !isOnline}
                  onClick={() => {
                    loadHistoryFromBackend();
                    if (jobUuid.trim()) fetchJobEvents(jobUuid.trim());
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">Notes</div>
            <textarea
              value={jobComments}
              onChange={(e) => setJobComments(e.target.value)}
              placeholder={ht.jobNotesPlaceholder}
            />
          </div>

          <div className="card">
            <div className="sectionTitle">Activity</div>

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
                          className="chip"
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            color: e.sync_status === "synced" ? "var(--ok)" : "var(--brand2)",
                            borderColor: e.sync_status === "synced" ? "rgba(45,212,191,0.3)" : "rgba(106,167,255,0.3)",
                          }}
                        >
                          {iconForStatus(e.sync_status)}
                        </span>
                        <strong style={{ fontSize: 14 }}>{e.type}</strong>
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
                      {/* Time + date — wrap independently so the date can
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
                          {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </button>
                        <span className="small" style={{ whiteSpace: "nowrap" }}>
                          {new Date(e.timestamp).toLocaleDateString()}
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
                          {new Date(e.logged_at ?? e.timestamp).toLocaleString([], {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}.
                        </div>
                        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
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

          {materialsSummary.length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                <div className="sectionTitle">Materials ({materialsSummary.length})</div>
                <div style={{ fontWeight: 700 }}>{money(materialsTotal)}</div>
              </div>
              <div className="col" style={{ gap: 4, marginTop: 8 }}>
                {materialsSummary.map((m, i) => {
                  const ext = m.unitPrice == null ? null : m.unitPrice * m.qty;
                  return (
                    <div key={`${m.submissionId}:${i}`} className="row small" style={{ justifyContent: "space-between", color: "var(--text)", opacity: m.pending ? 0.7 : 1 }}>
                      <span>
                        {m.qty}× {m.name}
                        {m.pending && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--brand)" }}>• syncing</span>}
                      </span>
                      <span style={{ color: "var(--muted)" }}>
                        {ext != null ? money(ext) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="small" style={{ color: "var(--muted)", marginTop: 8 }}>
                Manage via the Report tab · Bill Helper · Materials
              </div>
            </div>
          )}
        </>
      )}

      {/* Photos */}
      {tab === "photos" && (
        <>
          {/* Pending photo — caption + save */}
          {pendingPhotoFile ? (
            <div className="card">
              <div className="sectionTitle">Add Photo</div>
              <img
                src={URL.createObjectURL(pendingPhotoFile)}
                alt="preview"
                style={{ width: "100%", borderRadius: 8, marginBottom: 10 }}
              />
              <div className="col" style={{ gap: 8 }}>
                <div className="label">Note (optional)</div>
                <textarea
                  value={pendingCaption}
                  onChange={(e) => setPendingCaption(e.target.value)}
                  placeholder={ht.photoCaptionPlaceholder}
                  rows={2}
                  autoFocus
                />
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btnPrimary" onClick={onSavePendingPhoto} disabled={photoBusy}>
                    {photoBusy ? "Saving…" : "Save Photo"}
                  </button>
                  <button onClick={() => { setPendingPhotoFile(null); setPendingCaption(""); }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="sectionTitle">Photos</div>
              {ht.photosHint && (
                <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5, marginTop: 2 }}>
                  {ht.photosHint}
                </div>
              )}
              <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
                <label className="btnPrimary" style={{ cursor: photoBusy ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)" }}>
                  {photoBusy ? "Working…" : "Add Photo"}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    disabled={photoBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.currentTarget.value = "";
                      onPickPhotoFile(f);
                    }}
                  />
                </label>
                <button onClick={refreshPhotos} disabled={photoBusy}>Refresh</button>
              </div>
              {photoError && (
                <div className="small" style={{ color: "var(--danger)", marginTop: 8 }}>{photoError}</div>
              )}
            </div>
          )}

          <div className="card">
            <div className="sectionTitle">Saved</div>

            {photos.length === 0 && serverPhotos.filter(sp => !photos.some(lp => lp.id === sp.id)).length === 0 ? (
              <div className="small">{jobUuid ? "No photos yet." : "Select a job to see photos."}</div>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                {photos.map((p) => {
                  const url = URL.createObjectURL(p.blob);
                  const driveOk = p.drive_status === "uploaded";
                  const driveFail = p.drive_status === "failed";
                  return (
                    <div
                      key={p.id}
                      style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.02)" }}
                    >
                      <img
                        src={url}
                        alt={p.caption || "job photo"}
                        style={{ width: "100%", display: "block" }}
                        onLoad={() => URL.revokeObjectURL(url)}
                      />
                      <div style={{ padding: 10 }}>
                        {p.caption && (
                          <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.caption}</div>
                        )}
                        <div className="small" style={{ color: "var(--muted)" }}>{new Date(p.created_at).toLocaleString()}</div>
                        <div className="row wrap" style={{ marginTop: 8, gap: 6, alignItems: "center" }}>
                          {driveOk && p.drive_url ? (
                            <a href={p.drive_url} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: "var(--ok)", textDecoration: "none", border: "1px solid rgba(45,212,191,0.3)", padding: "2px 8px", borderRadius: 999 }}>
                              View in Drive
                            </a>
                          ) : driveFail ? (
                            <>
                              <span style={{ fontSize: 11, color: "var(--danger)" }} title={p.drive_error}>
                                Drive upload failed{p.drive_error ? ` — ${p.drive_error}` : ""}
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
                      {sp.caption && <div style={{ fontWeight: 600, marginBottom: 6 }}>{sp.caption}</div>}
                      <div className="small" style={{ color: "var(--muted)" }}>{new Date(sp.created_at).toLocaleString()}</div>
                      {sp.created_by && (
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          <UserAvatar displayName={sp.created_by} size={18} />
                          <span className="small" style={{ color: "var(--muted)" }}>by {sp.created_by}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 8 }}>
                        <a href={sp.drive_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "var(--ok)", textDecoration: "none", border: "1px solid rgba(45,212,191,0.3)", padding: "2px 8px", borderRadius: 999 }}>
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

      {/* Report */}
      {tab === "report" && (
        <JobReport jobUuid={jobUuid} jobName={jobName} />
      )}

      {/* DVIR reminder modal — shown before START or FINISH */}
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
