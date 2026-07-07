// Offline-durable incident submission. Incidents are rare but must survive a
// signal drop in the field, so each submit is queued in localStorage and
// drained (idempotent by incident_uuid) when connectivity returns - mirroring
// the job-inventory queue.

import { apiFetch, ApiError } from "../api/client";

export type Severity = "minor" | "moderate" | "major";
export type Attributable = "yes" | "no" | "unknown";

export type IncidentPayload = {
  incident_uuid: string;
  // Human-readable claim number generated on the device at submit (offline-safe).
  claim_number: string;
  job_uuid: string | null;
  job_name: string | null;
  incident_date: string | null;
  attributed_crew: string | null;
  severity: Severity;
  // Retained for back-compat with the backend/admin log; the crew form no longer
  // collects attributability, estimated cost, or the extra notes field.
  attributable: Attributable;
  description: string;
  est_cost: number | null;
  resolved: boolean;
  notes: string | null;
  photo_urls: string[];
};

export type IncidentOut = IncidentPayload & {
  id: number;
  reported_by_name: string | null;
  created_at: string;
};

const QUEUE_KEY = "crew_incident_queue_v1";

function loadAll(): IncidentPayload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as IncidentPayload[]) : [];
  } catch {
    return [];
  }
}

function saveAll(q: IncidentPayload[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - noop */
  }
}

export function enqueueIncident(p: IncidentPayload): void {
  const q = loadAll().filter((x) => x.incident_uuid !== p.incident_uuid);
  q.push(p);
  saveAll(q);
}

export function pendingIncidents(jobUuid: string): IncidentPayload[] {
  return loadAll().filter((x) => (x.job_uuid || "") === jobUuid);
}

// Drain queued incidents. Idempotent server-side, so a retry is always safe.
export async function drainIncidents(): Promise<void> {
  if (!navigator.onLine) return;
  for (const p of loadAll()) {
    try {
      await apiFetch("/api/incidents", { method: "POST", body: JSON.stringify(p) });
      saveAll(loadAll().filter((x) => x.incident_uuid !== p.incident_uuid));
    } catch (e) {
      // Permanent client error (bad data) → drop so it can't wedge the queue.
      // Network / auth / 5xx → stop and retry the whole queue next pass.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 408) {
        saveAll(loadAll().filter((x) => x.incident_uuid !== p.incident_uuid));
      } else {
        return;
      }
    }
  }
}

// Submit an incident: queue for durability, then try to flush immediately.
export async function submitIncident(p: IncidentPayload): Promise<void> {
  enqueueIncident(p);
  await drainIncidents();
}

export async function fetchJobIncidents(jobUuid: string): Promise<IncidentOut[]> {
  if (!jobUuid.trim()) return [];
  return apiFetch<IncidentOut[]>(`/api/incidents?job_uuid=${encodeURIComponent(jobUuid)}`);
}

export function newIncidentUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `inc-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

// Human-readable claim number: "MC-YYYYMMDD-XXXX". The date segment is the
// incident date (falls back to today) and the 4-char code is derived from the
// incident uuid so it's stable and collision-resistant without a server round
// trip - the crew sees it instantly, even offline. `dateStr` is "YYYY-MM-DD".
export function newClaimNumber(dateStr: string | null, uuid: string): string {
  const ymd = (dateStr || "").replace(/-/g, "").slice(0, 8) ||
    new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hex = uuid.replace(/[^a-fA-F0-9]/g, "").slice(0, 4).toUpperCase().padEnd(4, "0");
  return `MC-${ymd}-${hex}`;
}
