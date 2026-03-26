import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "./assets/logo.png";
import { useAuth } from "./auth/AuthContext";
import { apiFetch } from "./api/client";
import { addPhoto, deletePhoto, listPhotosForJob, updatePhoto, type StoredPhoto } from "./lib/photoStore";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// LocalStorage keys
const QUEUE_KEY = "crew_event_queue_v1"; // unsynced events only
const LOG_KEY = "crew_event_log_v1"; // full job activity log (synced + queued)
const JOB_KEY = "crew_active_job_uuid_v1";
const JOB_STATUS_KEY = "crew_job_status_v1"; // "active" | "closed"
const COMMENTS_PREFIX = "crew_job_comments_v1:"; // per job_uuid

// Per-job metadata (existing)
const JOB_NAME_PREFIX = "crew_job_name_v1:"; // per job_uuid
const JOB_DATE_PREFIX = "crew_job_date_v1:"; // per job_uuid

// NEW: job meta + calendar binding (fixes "events under wrong job name")
const JOB_META_PREFIX = "crew_job_meta_v1:"; // per job_uuid
const CAL_BIND_PREFIX = "crew_cal_bind_v1:"; // per date+calendarEventId => job_uuid

type Tab = "timeline" | "photos" | "materials";

type EventRecord = {
  event_id: string;
  job_uuid: string;
  type: string;
  timestamp: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  note?: string | null;
  created_by?: string;
  sync_status: "queued" | "synced";
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

type MaterialCatalogItem = {
  name: string;
  unitPrice: number | null; // null => requires cost input (10% markup rule)
};

type MaterialLineItem = {
  id: string;
  name: string;
  qty: number;
  unitPrice: number | null; // null => TBD
  source: "catalog" | "custom";
  baseCost?: number | null;
};

type MaterialsDraft = {
  jobLabel: string;
  notes: string;
  items: MaterialLineItem[];
};

type MaterialsSubmission = {
  id: string;
  created_at: string;
  job_uuid: string;
  jobLabel: string;
  jobName: string;
  jobDate: string;
  notes: string;
  items: MaterialLineItem[];
  total: number;
};

const MATERIALS_DRAFT_PREFIX = "crew_materials_draft_v1:"; // per job_uuid
const MATERIALS_SUBMISSIONS_KEY = "crew_materials_submissions_v1"; // global list

const MATERIAL_CATALOG: MaterialCatalogItem[] = [
  { name: "Small Box", unitPrice: 2.0 },
  { name: "Medium Moving Box", unitPrice: 2.5 },
  { name: "Large Box", unitPrice: 3.0 },
  { name: "Small Wardrobe", unitPrice: 21.0 },
  { name: "Large Wardrobe", unitPrice: 24.0 },
  { name: "Dish Barrel", unitPrice: 9.0 },
  { name: "Four Piece Mirror Pack", unitPrice: 11.0 },
  { name: "Packing Paper (200 Sheets)", unitPrice: 26.0 },
  { name: "Packing Paper (500 Sheets)", unitPrice: 44.0 },
  { name: "Paper Pads", unitPrice: 12.5 },
  { name: "Bubble Wrap (Per Roll)", unitPrice: 33.0 },
  { name: "Tape (Per Roll)", unitPrice: 3.0 },
  { name: "Plastic Couch Cover", unitPrice: 8.0 },
  { name: "Mattress Bag (Any Size)", unitPrice: 9.5 },
  { name: "Light Duty Furniture Pad", unitPrice: 10.0 },
  { name: "Heavy-Duty Pad", unitPrice: 22.0 },
  { name: "Small Wrap", unitPrice: 12.5 },
  { name: "Medium Wrap", unitPrice: 22.0 },
];

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

export default function App() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("timeline");

  const [jobUuid, setJobUuid] = useState<string>(() => localStorage.getItem(JOB_KEY) || "");
  const [jobStatus, setJobStatus] = useState<"active" | "closed">(
    () => (localStorage.getItem(JOB_STATUS_KEY) as any) || "active"
  );

  const [status, setStatus] = useState<string>("");
  const [response, setResponse] = useState<any>(null);

  const [queueLen, setQueueLen] = useState<number>(0);
  const [queueEvents, setQueueEvents] = useState<EventRecord[]>([]);
  const [activityLog, setActivityLog] = useState<EventRecord[]>([]);

  const [clockText, setClockText] = useState<string>("—");

  // Job metadata (display + persistence)
  const [jobName, setJobName] = useState<string>("");
  const [jobDate, setJobDate] = useState<string>(() => todayLocalYYYYMMDD());

  // Comments (per job_uuid)
  const [jobComments, setJobComments] = useState<string>("");

  // Calendar
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string>("");
  const [calWarning, setCalWarning] = useState<string>(""); // NEW
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [calSelectedId, setCalSelectedId] = useState<string>("");
  const [calLoaded, setCalLoaded] = useState<boolean>(false); // NEW

  // Photos
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string>("");
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingCaption, setPendingCaption] = useState<string>("");

  // Materials
  const [matJobLabel, setMatJobLabel] = useState<string>("");
  const [matNotes, setMatNotes] = useState<string>("");
  const [matItems, setMatItems] = useState<MaterialLineItem[]>([]);
  const [matError, setMatError] = useState<string>("");

  const [matSelectedName, setMatSelectedName] = useState<string>("");
  const [matCustomName, setMatCustomName] = useState<string>("");
  const [matCustomCost, setMatCustomCost] = useState<string>("");
  const [matQty, setMatQty] = useState<number>(1);

  const [isSending, setIsSending] = useState(false);
  const [serverEvents, setServerEvents] = useState<EventRecord[]>([]);

  const canSend = useMemo(() => jobUuid.trim().length > 0, [jobUuid]);

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
    localStorage.setItem(key, JSON.stringify(val));
  }

  function loadQueue(): EventRecord[] {
    return loadJson<EventRecord[]>(QUEUE_KEY, []);
  }

  function saveQueue(q: EventRecord[]) {
    saveJson(QUEUE_KEY, q);
    setQueueLen(q.length);
    setQueueEvents(q);
  }

  function loadLog(): EventRecord[] {
    return loadJson<EventRecord[]>(LOG_KEY, []);
  }

  function saveLog(log: EventRecord[]) {
    saveJson(LOG_KEY, log);
    setActivityLog(log);
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
  function getBoundJobUuid(date: string, calId: string) {
    try {
      return localStorage.getItem(calBindKey(date, calId)) || "";
    } catch {
      return "";
    }
  }
  function bindCalendarEventToJob(date: string, calId: string, uuid: string) {
    try {
      localStorage.setItem(calBindKey(date, calId), uuid);
    } catch {}
  }

  // Materials
  function materialsDraftKey(uuid: string) {
    return `${MATERIALS_DRAFT_PREFIX}${uuid || "none"}`;
  }
  function loadMaterialsDraft(uuid: string): MaterialsDraft | null {
    if (!uuid.trim()) return null;
    return loadJson<MaterialsDraft | null>(materialsDraftKey(uuid.trim()), null);
  }
  function saveMaterialsDraft(uuid: string, draft: MaterialsDraft) {
    if (!uuid.trim()) return;
    saveJson(materialsDraftKey(uuid.trim()), draft);
  }
  function appendMaterialsSubmission(sub: MaterialsSubmission) {
    const existing = loadJson<MaterialsSubmission[]>(MATERIALS_SUBMISSIONS_KEY, []);
    existing.unshift(sub);
    saveJson(MATERIALS_SUBMISSIONS_KEY, existing);
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

    setCalSelectedId("");
    setCalEvents([]);
    setCalError("");
    setCalWarning("");
    setCalLoaded(false);
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

  async function syncQueueNow() {
    const q = loadQueue();
    if (q.length === 0) {
      setStatus("Nothing to sync");
      return;
    }

    if (!navigator.onLine) {
      setStatus(`Offline (${q.length} queued)`);
      setResponse({ ok: false, reason: "offline", queued: q.length });
      return;
    }

    setStatus(`Syncing ${q.length}...`);

    const payload = {
      device_id: "dev-test",
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
        job_name: localStorage.getItem(JOB_NAME_PREFIX + e.job_uuid) ?? "",
        job_date: localStorage.getItem(JOB_DATE_PREFIX + e.job_uuid) ?? "",
        created_by: user?.name || user?.email || "",
      })),
    };

    try {
      const res = await fetch(`${API}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      setResponse(json);

      const acceptedAll =
        json?.ok === true && (json.inserted + json.duplicates) === q.length && (json.errors ?? 0) === 0;

      if (acceptedAll) {
        const ids = new Set(q.map((e) => e.event_id));
        markLogEventsSyncedByIds(ids);
        saveQueue([]);
        setStatus("Synced");
      } else {
        setStatus("Partial sync (kept queued)");
        saveQueue(q);
      }
    } catch (e: any) {
      setStatus(`Sync error (kept queued)`);
      saveQueue(q);
    }
  }

  async function recordEvent(type: string, note: string | null = null) {
    if (!canSend || isSending) return;

    setIsSending(true);
    setStatus("Capturing...");

    const loc = await tryGetLocation();

    const ev: EventRecord = {
      event_id: crypto.randomUUID(),
      job_uuid: jobUuid.trim(),
      type,
      timestamp: new Date().toISOString(),
      lat: loc.lat,
      lng: loc.lng,
      accuracy_m: loc.accuracy_m,
      note,
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
      setIsSending(false);
    }
  }

  async function addNoteToEntry(targetEventId: string) {
    const text = window.prompt("Add note (optional):", "");
    if (text == null) return;

    const trimmed = text.trim();
    const log = loadLog();
    const entry = log.find((e) => e.event_id === targetEventId);
    if (!entry) return;

    const updatedLog = log.map((e) => (e.event_id === targetEventId ? { ...e, note: trimmed || null } : e));
    saveLog(updatedLog);

    const q = loadQueue();
    const inQueue = q.some((e) => e.event_id === targetEventId);
    if (inQueue) {
      const updatedQ = q.map((e) => (e.event_id === targetEventId ? { ...e, note: trimmed || null } : e));
      saveQueue(updatedQ);
      await syncQueueNow();
      return;
    }

    if (trimmed.length > 0) await recordEvent("NOTE", trimmed);
  }

  // -----------------------
  // Calendar binding
  // -----------------------
  async function loadCalendarEvents() {
    setCalError("");
    setCalWarning("");
    setCalLoading(true);
    setCalEvents([]);
    setCalSelectedId("");
    setCalLoaded(false);

    try {
      const res = await fetch(`${API}/api/calendar/day?date=${encodeURIComponent(jobDate)}`);
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

  function onSelectCalendarEvent(calId: string) {
    setCalSelectedId(calId);
    const ev = calEvents.find((x) => x.id === calId);
    if (!ev) return;

    const bound = getBoundJobUuid(jobDate, calId);
    if (bound) {
      setPersistedJobUuid(bound);

      saveJobMeta({
        job_uuid: bound,
        jobName: ev.summary,
        jobDate,
        source: "calendar",
        calendarEventId: calId,
        updated_at: new Date().toISOString(),
      });

      saveJobName(bound, ev.summary);
      saveJobDate(bound, jobDate);

      setStatus("Switched job");
      fetchJobEvents(bound);
      return;
    }

    const newId = crypto.randomUUID();
    setPersistedJobUuid(newId);
    setPersistedJobStatus("active");

    bindCalendarEventToJob(jobDate, calId, newId);

    setJobName(ev.summary);

    saveJobMeta({
      job_uuid: newId,
      jobName: ev.summary,
      jobDate,
      source: "calendar",
      calendarEventId: calId,
      updated_at: new Date().toISOString(),
    });

    saveJobName(newId, ev.summary);
    saveJobDate(newId, jobDate);

    setStatus("New job from calendar");
    fetchJobEvents(newId);
  }


  async function fetchJobEvents(uuid: string) {
    if (!uuid.trim()) return;
    try {
      const data = await apiFetch<EventRecord[]>(`/api/events?job_uuid=${encodeURIComponent(uuid)}`);
      setServerEvents(data);
    } catch {
      // offline or error — server events unavailable, local queue still shown
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
      form.append("file", fileRef, fileRef.name || "photo.jpg");
      form.append("photo_id", photoId);
      form.append("job_uuid", jobUuid.trim());
      form.append("job_name", jobName);
      form.append("job_date", jobDate);
      form.append("caption", caption);

      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`${API}/api/photos/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const json = await res.json();
      if (res.ok && json.drive_url) {
        await updatePhoto(photoId, { drive_status: "uploaded", drive_url: json.drive_url });
        await refreshPhotos();
        setStatus("Photo saved to Drive");
      } else {
        await updatePhoto(photoId, { drive_status: "failed" });
        await refreshPhotos();
      }
    } catch {
      await updatePhoto(photoId, { drive_status: "failed" });
      await refreshPhotos();
    }

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
  // Materials
  // -----------------------
  function computeMaterialsTotal(items: MaterialLineItem[]) {
    return items.reduce((sum, it) => {
      if (it.unitPrice == null) return sum;
      return sum + it.unitPrice * it.qty;
    }, 0);
  }

  function resetMaterialsAddControls() {
    setMatSelectedName("");
    setMatCustomName("");
    setMatCustomCost("");
    setMatQty(1);
  }

  function loadOrInitMaterialsDraft() {
    setMatError("");

    if (!jobUuid.trim()) {
      setMatJobLabel(jobName || "");
      setMatNotes("");
      setMatItems([]);
      resetMaterialsAddControls();
      return;
    }

    const draft = loadMaterialsDraft(jobUuid.trim());
    if (draft) {
      setMatJobLabel(draft.jobLabel || jobName || "");
      setMatNotes(draft.notes || "");
      setMatItems(draft.items || []);
      resetMaterialsAddControls();
      return;
    }

    setMatJobLabel(jobName || "");
    setMatNotes("");
    setMatItems([]);
    resetMaterialsAddControls();
  }

  function persistMaterialsDraft() {
    if (!jobUuid.trim()) return;
    saveMaterialsDraft(jobUuid.trim(), { jobLabel: matJobLabel, notes: matNotes, items: matItems });
  }

  function addMaterialsItem() {
    setMatError("");

    if (!jobUuid.trim()) {
      setMatError("Set Job first");
      return;
    }

    const qty = Number.isFinite(matQty) ? Math.max(1, Math.floor(matQty)) : 1;

    if (matSelectedName && matSelectedName !== "__custom__") {
      const found = MATERIAL_CATALOG.find((m) => m.name === matSelectedName);
      if (!found) {
        setMatError("Material not found");
        return;
      }

      const item: MaterialLineItem = {
        id: crypto.randomUUID(),
        name: found.name,
        qty,
        unitPrice: found.unitPrice,
        source: "catalog",
      };

      setMatItems((prev) => [item, ...prev]);
      resetMaterialsAddControls();
      return;
    }

    if (matSelectedName === "__custom__") {
      const name = matCustomName.trim();
      if (!name) {
        setMatError("Custom name required");
        return;
      }

      const costRaw = matCustomCost.trim();
      let baseCost: number | null = null;
      let unitPrice: number | null = null;

      if (costRaw.length > 0) {
        const parsed = Number(costRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          setMatError("Cost must be a number");
          return;
        }
        baseCost = parsed;
        unitPrice = parsed * 1.1;
      }

      const item: MaterialLineItem = {
        id: crypto.randomUUID(),
        name,
        qty,
        unitPrice,
        baseCost,
        source: "custom",
      };

      setMatItems((prev) => [item, ...prev]);
      resetMaterialsAddControls();
      return;
    }

    setMatError("Select a material");
  }

  function removeMaterialsItem(id: string) {
    setMatItems((prev) => prev.filter((x) => x.id !== id));
  }

  async function submitMaterials() {
    setMatError("");

    if (!jobUuid.trim()) {
      setMatError("Set Job first");
      return;
    }
    if (matItems.length === 0) {
      setMatError("No items");
      return;
    }

    const total = computeMaterialsTotal(matItems);

    const sub: MaterialsSubmission = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      job_uuid: jobUuid.trim(),
      jobLabel: matJobLabel.trim(),
      jobName: jobName.trim(),
      jobDate,
      notes: matNotes.trim(),
      items: matItems,
      total,
    };

    appendMaterialsSubmission(sub);
    await recordEvent("NOTE", `MATERIALS ${money(total)} (${matItems.length})`);

    // POST to backend for Google Sheets export (non-blocking — don't fail the submission)
    try {
      await fetch(`${API}/api/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
    } catch (_) {
      // network failure — materials still saved locally
    }

    setMatNotes("");
    setMatItems([]);
    resetMaterialsAddControls();
    persistMaterialsDraft();

    setStatus("Materials submitted");
  }

  function cancelMaterials() {
    const ok = window.confirm("Clear draft?");
    if (!ok) return;

    setMatNotes("");
    setMatItems([]);
    resetMaterialsAddControls();

    if (jobUuid.trim()) {
      saveMaterialsDraft(jobUuid.trim(), { jobLabel: matJobLabel, notes: "", items: [] });
    }

    setStatus("Draft cleared");
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
    setQueueEvents(q);

    const log = loadLog();
    setActivityLog(log);

    setJobComments(loadCommentsForJob(jobUuid));

    const meta = loadJobMeta(jobUuid);
    if (meta) {
      setJobName(meta.jobName || "");
      setJobDate(meta.jobDate || todayLocalYYYYMMDD());
    } else {
      const loadedName = loadJobName(jobUuid);
      setJobName(loadedName);
      const storedDate = loadJobDate(jobUuid);
      setJobDate(storedDate || todayLocalYYYYMMDD());
    }

    const onOnline = () => syncQueueNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => {
      const log = loadLog();
      setClockText(computeClockHoursText(log));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobUuid, jobStatus]);

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

  // NEW: when date changes, calendar results are stale
  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, jobUuid]);

  useEffect(() => {
    if (tab !== "materials") return;
    loadOrInitMaterialsDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, jobUuid]);

  useEffect(() => {
    if (tab !== "materials") return;
    persistMaterialsDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, matJobLabel, matNotes, matItems]);

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

  const materialsTotal = useMemo(() => computeMaterialsTotal(matItems), [matItems]);

  const mergedLog = useMemo(() => {
    const localQueued = queueEvents.filter((e) => e.job_uuid === jobUuid.trim());
    const queuedIds = new Set(localQueued.map((e) => e.event_id));
    const synced = serverEvents.filter((e) => !queuedIds.has(e.event_id));
    return [...localQueued, ...synced].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [serverEvents, queueEvents, jobUuid]);

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
          <img className="logo" src={logo} alt="Logo" style={{ filter: "invert(1) brightness(1.15) contrast(1.05)" }} />
          <div>
            <div className="title">Mountaineer Moving Co.</div>
            <div className="small">{clockText === "—" ? "Clock starts at Start" : `Clock: ${clockText}`}</div>
          </div>
        </div>

        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          <span className="chip" style={{ color: navigator.onLine ? "var(--ok)" : "var(--danger)" }}>
            {navigator.onLine ? "Online" : "Offline"}
          </span>
          <span className="chip" style={queueLen > 0 ? { color: "var(--brand2)", borderColor: "rgba(106,167,255,0.35)" } : {}}>
            Queue {queueLen}
          </span>
          <span className="chip" style={{ color: jobStatus === "active" ? "var(--ok)" : "var(--muted)", textTransform: "capitalize" }}>
            {jobStatus}
          </span>
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
            onClick={() => nav("/profile")}
            style={{ cursor: "pointer", background: "none", border: "1px solid rgba(255,255,255,0.3)" }}
          >
            Profile
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabbar">
        <button className={"tab " + (tab === "timeline" ? "active" : "")} onClick={() => setTab("timeline")}>
          Timeline
        </button>
        <button className={"tab " + (tab === "photos" ? "active" : "")} onClick={() => setTab("photos")}>
          Photos
        </button>
        <button className={"tab " + (tab === "materials" ? "active" : "")} onClick={() => setTab("materials")}>
          Materials
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
                  <option value="" style={optionStyle}>
                    {calLoading ? "Loading calendar…" : calEvents.length > 0 ? "Select a job…" : calLoaded ? "No jobs on this date" : "Loading…"}
                  </option>
                  {calEvents.map((ev) => (
                    <option key={ev.id} value={ev.id} style={optionStyle}>
                      {ev.summary}
                    </option>
                  ))}
                </select>
                {calError && <div className="small" style={{ color: "var(--danger)", marginTop: 4 }}>{calError}</div>}
                {calWarning && <div className="small" style={{ marginTop: 4 }}>{calWarning}</div>}
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
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">Actions</div>

            <div className="col" style={{ gap: 10 }}>
              <div className="row wrap">
                <button className="btnPrimary" disabled={!canSend || isSending} onClick={() => recordEvent("ARRIVE")}>
                  {isSending ? "..." : "Arrive"}
                </button>
                <button className="btnPrimary" disabled={!canSend || isSending} onClick={() => recordEvent("DEPART")}>
                  {isSending ? "..." : "Depart"}
                </button>
                <button className="btnPrimary" disabled={!canSend || isSending} onClick={() => recordEvent("START")}>
                  {isSending ? "..." : "Start"}
                </button>
                <button className="btnPrimary" disabled={!canSend || isSending} onClick={() => recordEvent("FINISH")}>
                  {isSending ? "..." : "Finish"}
                </button>
              </div>

              <div className="row wrap" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <button disabled={queueLen === 0} onClick={syncQueueNow}>
                  {queueLen > 0 ? `Sync (${queueLen} pending)` : "Sync"}
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">Notes</div>
            <textarea
              value={jobComments}
              onChange={(e) => setJobComments(e.target.value)}
              placeholder="Notes for this job…"
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
                      <div className="row" style={{ gap: 8 }}>
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
                          <span className="small" style={{ color: "var(--muted)" }}>{e.created_by}</span>
                        )}
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        {e.lat != null && (
                          <span className="small">±{Math.round(e.accuracy_m ?? 0)}m</span>
                        )}
                        <span className="small">
                          {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" · "}
                          {new Date(e.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {e.note && (
                      <div className="small" style={{ marginTop: 5, fontStyle: "italic", color: "var(--muted)" }}>
                        "{e.note}"
                      </div>
                    )}

                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => addNoteToEntry(e.event_id)} style={{ padding: "4px 10px", fontSize: 12 }}>
                        + Note
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details style={{ marginTop: 8 }}>
            <summary className="small" style={{ cursor: "pointer", color: "var(--muted)", opacity: 0.5, userSelect: "none", listStyle: "none" }}>
              ··· debug
            </summary>
            <div
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div className="small">Queued: {queueEvents.length} · Log: {activityLog.length}</div>
              {response != null && (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--muted)",
                  }}
                >
                  {JSON.stringify(response, null, 2)}
                </pre>
              )}
            </div>
          </details>
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
                  placeholder="Describe what's in this photo…"
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
              <div className="row wrap" style={{ marginTop: 10, gap: 8 }}>
                <label className="btnPrimary" style={{ cursor: photoBusy ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", padding: "10px 18px", borderRadius: "var(--btn-r)" }}>
                  {photoBusy ? "Working…" : "Add Photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
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

            {photos.length === 0 ? (
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
                            <span style={{ fontSize: 11, color: "var(--danger)" }}>Drive upload failed</span>
                          ) : p.drive_status === "pending" ? (
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Uploading…</span>
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
              </div>
            )}
          </div>
        </>
      )}

      {/* Materials */}
      {tab === "materials" && (
        <>
          <div className="card">
            <div className="sectionTitle">Log Materials</div>

            <div className="col" style={{ gap: 12 }}>
              <div className="col">
                <div className="label">Job</div>
                <input value={matJobLabel} onChange={(e) => setMatJobLabel(e.target.value)} placeholder="Job name…" />
                <div className="small">Custom items: enter cost → +10%.</div>
              </div>

              <div className="row wrap" style={{ alignItems: "flex-end" }}>
                <div className="col" style={{ flex: 1, minWidth: 220 }}>
                  <div className="label">Material</div>
                  <select value={matSelectedName} onChange={(e) => setMatSelectedName(e.target.value)} style={selectStyle}>
                    <option value="" style={optionStyle}>
                      Select…
                    </option>
                    {MATERIAL_CATALOG.map((m) => (
                      <option key={m.name} value={m.name} style={optionStyle}>
                        {m.name} — {m.unitPrice != null ? money(m.unitPrice) : "TBD"}
                      </option>
                    ))}
                    <option value="__custom__" style={optionStyle}>
                      Custom item…
                    </option>
                  </select>
                </div>

                <div className="col" style={{ width: 110 }}>
                  <div className="label">Qty</div>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={matQty}
                    onChange={(e) => setMatQty(Math.max(1, Math.floor(Number(e.target.value || 1))))}
                  />
                </div>

                <div className="col" style={{ width: 110 }}>
                  <button onClick={addMaterialsItem}>Add</button>
                </div>
              </div>

              {matSelectedName === "__custom__" ? (
                <div className="row wrap">
                  <div className="col" style={{ flex: 2, minWidth: 220 }}>
                    <div className="label">Custom name</div>
                    <input
                      value={matCustomName}
                      onChange={(e) => setMatCustomName(e.target.value)}
                      placeholder="Item name…"
                    />
                  </div>
                  <div className="col" style={{ flex: 1, minWidth: 160 }}>
                    <div className="label">Cost (optional)</div>
                    <input
                      value={matCustomCost}
                      onChange={(e) => setMatCustomCost(e.target.value)}
                      placeholder="15.00"
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ) : null}

              {matError ? (
                <div className="small" style={{ color: "var(--danger)" }}>
                  {matError}
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="sectionTitle">Items</div>

            {matItems.length === 0 ? (
              <div className="small">No items yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        Material
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        Qty
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        Unit
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        Ext
                      </th>
                      <th style={{ textAlign: "right", padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                        Remove
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {matItems.map((it) => {
                      const unit = it.unitPrice == null ? "TBD" : money(it.unitPrice);
                      const ext = it.unitPrice == null ? "—" : money(it.unitPrice * it.qty);

                      return (
                        <tr key={it.id}>
                          <td style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ fontWeight: 700 }}>{it.name}</div>
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                            {it.qty}
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                            {unit}
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                            {ext}
                          </td>
                          <td style={{ padding: "8px 6px", textAlign: "right", borderBottom: "1px solid var(--border)" }}>
                            <button onClick={() => removeMaterialsItem(it.id)} style={{ padding: "6px 10px", fontSize: 12 }}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 12, fontWeight: 800, fontSize: 16 }}>Total: {money(materialsTotal)}</div>
          </div>

          <div className="card">
            <div className="sectionTitle">Notes</div>
            <textarea value={matNotes} onChange={(e) => setMatNotes(e.target.value)} placeholder="Notes (optional)…" />
            <div className="row wrap" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={cancelMaterials}>Cancel</button>
              <button className="btnPrimary" onClick={submitMaterials}>
                Submit
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
