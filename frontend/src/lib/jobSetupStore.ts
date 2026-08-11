/**
 * Job setup (header) store - ADR 0034, C1.2.
 *
 * Offline-safe like the other outboxes: the header is cached to localStorage so
 * it displays offline, and a save that can't reach the server is queued and
 * retried on reconnect (drainable from App.tsx). A save the server actively
 * REJECTS (e.g. a locked header, 409) is surfaced, not queued - retrying it
 * forever would never succeed. Keyed by job_uuid; one header per job.
 */
import { apiFetch } from "../api/client";
import { isPermanentRejection, failureMark, CLEARED_FAILURE, type MaybeFailed } from "./queueFailure";

export type CrewMember = {
  user_id: number | null;
  name: string;
  source: "invitee" | "added";
  confirmed: boolean;
};

// The long-distance Bill of Lading shipment header the job header owns (ADR 0034).
// Every field seeds the BOL blank-only. Keys mirror the BOLDraft shipment fields.
export type BolHeader = {
  shipper_name?: string;
  shipper_phone?: string;
  shipper_address?: string;
  form_of_payment?: string;
  estimate_type?: string;
  valuation?: string;
  agreed_pickup?: string;
  agreed_delivery?: string;
  cod_notify?: string;
  cod_max?: string;
  additional_carriers?: string;
  third_party_insurance?: string;
  accessorial_services?: string;
};

export type JobSetupData = {
  job_name: string | null;
  job_date: string | null;
  source: string | null;
  calendar_event_id: string | null;
  is_long_distance: boolean;
  job_type_tags: string[];
  vehicle_unit_names: string[];
  crew: CrewMember[];
  origin: string | null;
  destination: string | null;
  stops: string[];
  bol_header?: BolHeader | null;
  notes: string | null;
  locked: boolean;
  updated_by_name?: string | null;
  updated_at?: string | null;
};

const CACHE_KEY = "crew_job_setup_cache_v1";
const QUEUE_KEY = "crew_job_setup_queue_v1";

type Bag = Record<string, JobSetupData>;

/** A queued header save, widened with the ADR 0013 failure mark. All the mark's
 *  fields are optional, so a queue already sitting on a crew phone stays
 *  readable and counts as pending. */
type QueuedSetup = JobSetupData & MaybeFailed;
type QueueBag = Record<string, QueuedSetup>;

function loadBag(key: string): Bag {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function saveBag(key: string, bag: Bag) {
  try {
    localStorage.setItem(key, JSON.stringify(bag));
  } catch {
    /* quota - the retry just won't persist across reload */
  }
}

export function getCachedJobSetup(jobUuid: string): JobSetupData | null {
  return loadBag(CACHE_KEY)[jobUuid] ?? null;
}
function cacheJobSetup(jobUuid: string, data: JobSetupData) {
  const bag = loadBag(CACHE_KEY);
  bag[jobUuid] = data;
  saveBag(CACHE_KEY, bag);
}
function enqueue(jobUuid: string, data: JobSetupData) {
  const bag = loadBag(QUEUE_KEY);
  bag[jobUuid] = data;
  saveBag(QUEUE_KEY, bag);
}
function dequeue(jobUuid: string) {
  const bag = loadBag(QUEUE_KEY);
  if (jobUuid in bag) {
    delete bag[jobUuid];
    saveBag(QUEUE_KEY, bag);
  }
}

/** Load a job's header. Cached-first so an offline open still shows the last
 *  known header; a successful fetch refreshes the cache. */
export async function loadJobSetup(jobUuid: string): Promise<JobSetupData | null> {
  try {
    const r = await apiFetch<{ setup: JobSetupData | null }>(
      `/api/job-setup/${encodeURIComponent(jobUuid)}`,
    );
    if (r.setup) cacheJobSetup(jobUuid, r.setup);
    return r.setup ?? getCachedJobSetup(jobUuid);
  } catch {
    return getCachedJobSetup(jobUuid);
  }
}

/** Save a job's header. Returns synced:false and queues on a network failure
 *  (never loses the edit); rethrows an ApiError so the UI can show a real
 *  rejection (a locked header, a validation error) instead of pretending it
 *  saved. */
export async function saveJobSetup(
  jobUuid: string,
  body: JobSetupData & { override?: boolean },
): Promise<{ synced: boolean; setup?: JobSetupData }> {
  cacheJobSetup(jobUuid, body); // optimistic - the edit shows immediately
  try {
    const r = await apiFetch<{ setup: JobSetupData }>(
      `/api/job-setup/${encodeURIComponent(jobUuid)}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    dequeue(jobUuid);
    if (r.setup) cacheJobSetup(jobUuid, r.setup);
    return { synced: true, setup: r.setup };
  } catch (e) {
    if (isPermanentRejection(e)) {
      // The server refused with a client error (locked 409 / invalid). A retry
      // will never succeed; surface it instead of queuing forever.
      throw e;
    }
    // Transient (5xx/408/429/401/403) or network down - queue and retry.
    enqueue(jobUuid, body);
    return { synced: false };
  }
}

/** Drain queued header saves. Call on reconnect / app boot.
 *
 *  A permanent rejection MARKS the entry failed and KEEPS it (ADR 0013). This
 *  used to `dequeue(jobUuid)`, which silently destroyed a queued job header -
 *  addresses, crew, shipment details somebody typed in the field - with nothing
 *  shown to anyone. Marked entries are skipped on later drains so one refused
 *  header cannot wedge the others. */
export async function drainJobSetups(): Promise<void> {
  const bag = loadBag(QUEUE_KEY) as QueueBag;
  const uuids = Object.keys(bag);
  if (!uuids.length) return;
  let dirty = false;
  for (const jobUuid of uuids) {
    if (bag[jobUuid].failed_at) continue; // refused; waits for Retry or Discard
    try {
      const r = await apiFetch<{ setup: JobSetupData }>(
        `/api/job-setup/${encodeURIComponent(jobUuid)}`,
        { method: "PUT", body: JSON.stringify(bag[jobUuid]) },
      );
      if (r.setup) cacheJobSetup(jobUuid, r.setup);
      delete bag[jobUuid];
      dirty = true;
    } catch (e) {
      // Transient (5xx/408/429/401/403) and network failures stay queued
      // untouched for the next drain.
      if (isPermanentRejection(e)) {
        Object.assign(bag[jobUuid], failureMark(e));
        dirty = true;
      }
    }
  }
  if (dirty) saveBag(QUEUE_KEY, bag);
}

/** Headers still waiting to sync. Excludes failed ones: they need a decision,
 *  and counting them would leave the unsynced indicator permanently lit. */
export function pendingJobSetups(): number {
  return Object.values(loadBag(QUEUE_KEY) as QueueBag).filter((v) => !v.failed_at).length;
}

/** Headers the server permanently refused, kept per ADR 0013. */
export function failedJobSetups(): Array<{ job_uuid: string; entry: QueuedSetup }> {
  return Object.entries(loadBag(QUEUE_KEY) as QueueBag)
    .filter(([, v]) => v.failed_at)
    .map(([job_uuid, entry]) => ({ job_uuid, entry }));
}

/** Clear the failed mark so the next drain picks it up again. */
export async function retryFailedJobSetup(jobUuid: string): Promise<void> {
  const bag = loadBag(QUEUE_KEY) as QueueBag;
  if (!bag[jobUuid]) return;
  Object.assign(bag[jobUuid], CLEARED_FAILURE);
  saveBag(QUEUE_KEY, bag);
  await drainJobSetups();
}

/** Explicit, user-initiated delete. The ONLY way a refused header leaves the
 *  queue without reaching the server (ADR 0013). */
export function discardFailedJobSetup(jobUuid: string): void {
  dequeue(jobUuid);
}
