// Offline-durable incident submission. Incidents are rare but must survive a
// signal drop in the field, so each submit is queued in localStorage and
// drained (idempotent by incident_uuid) when connectivity returns - mirroring
// the job-inventory queue.

import { apiFetch } from "../api/client";
import {
  CLEARED_FAILURE,
  failureMark,
  isPermanentRejection,
  type MaybeFailed,
} from "./queueFailure";

export type Severity = "minor" | "moderate" | "major";
export type Attributable = "yes" | "no" | "unknown";

const FIELD_LABELS: Record<string, string> = {
  description: "What happened",
  severity: "Severity",
  incident_date: "Date",
  attributed_crew: "Crew member",
  claim_number: "Claim number",
  job_uuid: "Job",
};

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

// A queued incident, plus the failure mark it carries if the server refused it.
export type QueuedIncident = IncidentPayload & MaybeFailed;

function loadAll(): QueuedIncident[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedIncident[]) : [];
  } catch {
    return [];
  }
}

function saveAll(q: QueuedIncident[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* quota - noop */
  }
}

function patch(incidentUuid: string, fields: MaybeFailed): void {
  saveAll(
    loadAll().map((x) =>
      x.incident_uuid === incidentUuid ? { ...x, ...fields } : x,
    ),
  );
}

export function enqueueIncident(p: IncidentPayload): void {
  const q = loadAll().filter((x) => x.incident_uuid !== p.incident_uuid);
  q.push(p);
  saveAll(q);
}

export function pendingIncidents(jobUuid: string): QueuedIncident[] {
  return loadAll().filter((x) => (x.job_uuid || "") === jobUuid);
}

/**
 * Drain queued incidents. Idempotent server-side, so a retry is always safe.
 *
 * A permanent 4xx does NOT delete the incident (ADR 0013). An incident is a
 * liability record whose photos exist only on that phone; deleting it because we
 * sent a payload the API refused destroys the only copy, silently. It is marked
 * failed instead, skipped by the drain so it cannot wedge the queue behind it,
 * and surfaced to the crew member with the reason and a Retry.
 *
 * Returns the uuids that were rejected on this pass, so a caller that just hit
 * submit can tell the crew member the truth rather than showing a success toast.
 */
export async function drainIncidents(): Promise<string[]> {
  if (!navigator.onLine) return [];
  const rejected: string[] = [];
  for (const p of loadAll()) {
    if (p.failed_at) continue; // waiting on a person, not on the network
    try {
      await apiFetch("/api/incidents", { method: "POST", body: JSON.stringify(p) });
      saveAll(loadAll().filter((x) => x.incident_uuid !== p.incident_uuid));
    } catch (e) {
      if (isPermanentRejection(e)) {
        patch(p.incident_uuid, failureMark(e, FIELD_LABELS));
        rejected.push(p.incident_uuid);
      } else {
        return rejected; // transient: stop, retry the whole queue next pass
      }
    }
  }
  return rejected;
}

/**
 * Submit an incident: queue for durability, then try to flush immediately.
 * Returns the failure reason when the server permanently refused it, so the
 * caller does not report success over a submission that did not land.
 */
export async function submitIncident(p: IncidentPayload): Promise<{ failedReason?: string }> {
  enqueueIncident(p);
  const rejected = await drainIncidents();
  if (rejected.includes(p.incident_uuid)) {
    const entry = loadAll().find((x) => x.incident_uuid === p.incident_uuid);
    return { failedReason: entry?.failed_reason || "The server rejected this report." };
  }
  return {};
}

/** Clear the failed mark so the next drain picks the incident up again. */
export async function retryFailedIncident(incidentUuid: string): Promise<string[]> {
  patch(incidentUuid, CLEARED_FAILURE);
  return drainIncidents();
}

/**
 * Explicit, crew-initiated delete of a failed incident. The ONLY way one leaves
 * the queue without reaching the server. Confirm before calling: this is the
 * destructive path ADR 0013 exists to keep out of the automatic drain.
 */
export function discardFailedIncident(incidentUuid: string): void {
  saveAll(loadAll().filter((x) => x.incident_uuid !== incidentUuid));
}

// Retroactive "resolved on site" for an incident still in the offline queue:
// edit the queued payload in place so it syncs already-resolved. Returns true
// when the uuid was found in the queue.
export function resolveQueuedIncident(incidentUuid: string, resolved = true): boolean {
  const q = loadAll();
  const idx = q.findIndex((x) => x.incident_uuid === incidentUuid);
  if (idx < 0) return false;
  q[idx] = { ...q[idx], resolved };
  saveAll(q);
  return true;
}

// Retroactive "resolved on site" for an already-synced incident (crew endpoint).
export async function resolveSyncedIncident(incidentUuid: string, resolved = true): Promise<void> {
  await apiFetch(`/api/incidents/${encodeURIComponent(incidentUuid)}/resolve`, {
    method: "PATCH",
    body: JSON.stringify({ resolved }),
  });
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
