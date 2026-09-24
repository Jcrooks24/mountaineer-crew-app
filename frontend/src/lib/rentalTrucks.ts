/**
 * Rental truck records client (ADR 0055).
 *
 * A rental is entered once, usually at the pre-trip DVIR, and then offered in
 * the truck list as "Rental*<job name>" so a multi-day job does not re-enter it.
 * The list is cached in localStorage so the picker still shows the crew's
 * trucks with no signal. Creating a truck rides the DVIR submit or the job
 * header save (which has its own offline queue), so there is no queue here.
 */
import { apiFetch } from "../api/client";
import { coalesce, invalidate } from "./sharedFetch";

export type RentalJobLink = {
  job_uuid: string;
  job_name: string;
  job_date: string | null;
  linked_at: string | null;
  linked_by_name: string | null;
};

export type RentalTruck = {
  rental_uuid: string;
  unit_name: string;
  plate: string;
  company: string | null;
  agreement_number: string | null;
  gvwr_lbs: number | null;
  notes: string | null;
  /** Every job this truck served, most recent first. */
  jobs: RentalJobLink[];
  latest_job_name: string;
  last_used_at: string | null;
  returned_at: string | null;
  returned_by_name: string | null;
  active: boolean;
};

const CACHE_KEY = "crew_rental_trucks_v1";

export function getActiveRentalsCached(): RentalTruck[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCache(list: RentalTruck[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled - the cache is best-effort */
  }
}

/** Rentals offered in the truck list: not returned, used in the last 10 days.
 *  Resolves to the cached list when offline, so a caller always gets something. */
export async function refreshActiveRentals(opts: { force?: boolean } = {}): Promise<RentalTruck[]> {
  return coalesce(
    "rentals:active",
    async () => {
      try {
        const r = await apiFetch<{ rentals: RentalTruck[] }>("/api/rentals");
        const list = Array.isArray(r?.rentals) ? r.rentals : [];
        setCache(list);
        return list;
      } catch {
        return getActiveRentalsCached();
      }
    },
    { ttlMs: 30_000, force: opts.force },
  );
}

/** Call after anything that creates, links or returns a truck. */
export function invalidateRentals(): void {
  invalidate("rentals:active");
}

/** Every truck linked to a job, most recent first. Empty when offline. */
export async function loadJobRentals(jobUuid: string): Promise<RentalTruck[]> {
  if (!jobUuid) return [];
  try {
    const r = await apiFetch<{ rentals: RentalTruck[] }>(
      `/api/rentals/for-job/${encodeURIComponent(jobUuid)}`,
    );
    return Array.isArray(r?.rentals) ? r.rentals : [];
  } catch {
    return [];
  }
}

/** The truck went back to the rental company. Online only: a returned truck
 *  only leaves the list, so there is nothing to lose by asking again later. */
export async function markRentalReturned(rentalUuid: string): Promise<RentalTruck> {
  const r = await apiFetch<{ rental: RentalTruck }>(
    `/api/rentals/${encodeURIComponent(rentalUuid)}/return`,
    { method: "POST" },
  );
  invalidateRentals();
  return r.rental;
}

/** Undo a wrong pick. The server refuses (409) once an inspection on this job
 *  was filed against the truck. Online only. */
export async function unlinkRentalFromJob(rentalUuid: string, jobUuid: string): Promise<void> {
  await apiFetch(
    `/api/rentals/${encodeURIComponent(rentalUuid)}/jobs/${encodeURIComponent(jobUuid)}`,
    { method: "DELETE" },
  );
  invalidateRentals();
}

/**
 * "Rental*<job name>", the owner's label (2026-09-24). Job names are not
 * unique, so when two listed trucks would read the same, `sub` carries the
 * plate to tell them apart. A truck with no job yet is labeled by its plate.
 */
export function rentalLabel(r: RentalTruck, all: RentalTruck[]): { label: string; sub: string | null } {
  const name = (r.latest_job_name || "").trim();
  const label = `Rental*${name || r.plate}`;
  const clash = !!name && all.some(
    (o) => o.rental_uuid !== r.rental_uuid && (o.latest_job_name || "").trim() === name,
  );
  return { label, sub: clash ? r.plate : null };
}

export function newRentalUuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
