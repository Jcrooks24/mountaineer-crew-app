// Close-out vocabularies for the job report: why the job differed from the
// quote, how ready the client was, and what changed on site.
//
// Mirrored on the backend in backend/app/schemas/job_report.py
// (VARIANCE_CAUSES / CLIENT_READINESS / CLIENT_UNREADY_REASONS /
// SCOPE_CHANGE_KINDS). Keep the two in sync - the server validates against its
// copy and rejects a key this file invents on its own.
//
// The stored value is the key, never the label. Labels can be reworded without
// orphaning a year of reports; keys cannot, so retiring one means leaving it
// here (the sheet export falls back to the raw key rather than a blank cell).

export type Option = { key: string; label: string };

/** Why the job ran differently than estimated. Single-select. */
export const VARIANCE_CAUSES: Option[] = [
  { key: "underestimated_volume", label: "Underestimated volume" },
  { key: "access_stairs_carry", label: "Access / stairs / long carry" },
  { key: "client_not_ready", label: "Client not ready" },
  { key: "crew_size_or_skill", label: "Crew size or skill" },
  { key: "scope_added_on_site", label: "Scope added on site" },
  { key: "travel_or_traffic", label: "Travel / traffic" },
  { key: "damage_or_repack", label: "Damage or repack" },
  { key: "other", label: "Other" },
];

/** How ready the client was on arrival. Single-select, best to worst. */
export const CLIENT_READINESS: Option[] = [
  { key: "fully_ready", label: "Fully ready" },
  { key: "mostly_ready", label: "Mostly ready" },
  { key: "partly_ready", label: "Partly ready" },
  { key: "not_ready", label: "Not ready" },
];

/** What specifically was not ready. Multi-select. */
export const CLIENT_UNREADY_REASONS: Option[] = [
  { key: "packing_incomplete", label: "Packing incomplete" },
  { key: "parking_not_reserved", label: "Parking not reserved" },
  { key: "elevator_not_reserved", label: "Elevator not reserved" },
  { key: "access_blocked", label: "Access blocked / clutter" },
  { key: "utilities_off", label: "Utilities off" },
  { key: "pets_or_kids", label: "Pets / kids underfoot" },
  { key: "paperwork_or_payment", label: "Paperwork or payment" },
  { key: "other", label: "Other" },
];

/** One row per thing that changed on site. */
export const SCOPE_CHANGE_KINDS: Option[] = [
  { key: "added_items", label: "Added items" },
  { key: "extra_stop", label: "Extra stop" },
  { key: "packing_added", label: "Packing added" },
  { key: "storage_added", label: "Storage added" },
  { key: "disposal_added", label: "Disposal added" },
  { key: "address_changed", label: "Address changed" },
  { key: "reduced_scope", label: "Reduced scope" },
  { key: "other", label: "Other" },
];

export type ScopeChangeEntry = {
  kind: string;
  /** Rough hours the change cost. Optional: logging that it happened matters
   *  more than pinning a number nobody can estimate at the tailgate. */
  hours?: number | null;
  note?: string;
};

/** Readiness values that mean something went wrong, so the follow-up question
 *  about what was not ready is worth asking. */
export function readinessNeedsDetail(readiness: string | null): boolean {
  return readiness !== null && readiness !== "" && readiness !== "fully_ready";
}
