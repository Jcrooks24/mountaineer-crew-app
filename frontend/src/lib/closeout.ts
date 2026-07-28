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

export type Option = {
  key: string;
  label: string;
  /** Which half of a two-directional list this belongs to. Drives the section
   *  headers in the pickers so a 14-chip list stays scannable on a phone. */
  group?: "more" | "less";
};

/** Why the job ran differently than estimated. Multi-select.
 *
 *  Both directions. The list used to describe only a job that ran LONG, which
 *  left a crew who finished early with nothing honest to tap - and cost the
 *  office the one signal that tells it an estimate was too high. */
export const VARIANCE_CAUSES: Option[] = [
  { key: "underestimated_volume", label: "Underestimated volume", group: "more" },
  { key: "access_stairs_carry", label: "Access / stairs / long carry", group: "more" },
  { key: "client_not_ready", label: "Client not ready", group: "more" },
  { key: "crew_size_or_skill", label: "Crew size or skill", group: "more" },
  { key: "scope_added_on_site", label: "Scope added on site", group: "more" },
  { key: "travel_or_traffic", label: "Travel / traffic", group: "more" },
  { key: "damage_or_repack", label: "Damage or repack", group: "more" },
  { key: "overestimated_volume", label: "Overestimated volume", group: "less" },
  { key: "easier_access", label: "Easier access than expected", group: "less" },
  { key: "client_ahead_of_prep", label: "Client further along than expected", group: "less" },
  { key: "scope_reduced_on_site", label: "Scope reduced on site", group: "less" },
  { key: "crew_faster_than_expected", label: "Crew faster than expected", group: "less" },
  { key: "other", label: "Other" },
];

/** How ready the client was on arrival. Single-select, best to worst.
 *
 *  Stays single-select on purpose: it is one ordinal answer about one moment,
 *  and "mostly ready AND not ready" is not a thing a crew member means. */
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

/** One row per thing that changed on site. Multi-select within a row: a single
 *  change is often two of these at once ("client dropped the storage unit and
 *  the second stop"), and splitting that into two rows inflated the count. */
export const SCOPE_CHANGE_KINDS: Option[] = [
  { key: "added_items", label: "Added items", group: "more" },
  { key: "extra_stop", label: "Extra stop", group: "more" },
  { key: "packing_added", label: "Packing added", group: "more" },
  { key: "storage_added", label: "Storage added", group: "more" },
  { key: "disposal_added", label: "Disposal added", group: "more" },
  { key: "address_changed", label: "Address changed", group: "more" },
  { key: "fewer_items", label: "Fewer items", group: "less" },
  { key: "stop_dropped", label: "Stop dropped", group: "less" },
  { key: "packing_not_needed", label: "Packing not needed", group: "less" },
  { key: "storage_not_needed", label: "Storage not needed", group: "less" },
  { key: "client_already_packed", label: "Client already packed", group: "less" },
  { key: "less_volume_than_estimated", label: "Less volume than estimated", group: "less" },
  { key: "other", label: "Other" },
];

// `reduced_scope` is not offered above any more - the specific reduction keys
// replaced it - but reports written before 2026-07-28 carry it, so it still
// needs a label anywhere stored keys get rendered back to the user.
const RETIRED_LABELS: Record<string, string> = {
  reduced_scope: "Reduced scope",
};

const ALL_LABELS: Record<string, string> = {
  ...RETIRED_LABELS,
  ...Object.fromEntries(
    [...VARIANCE_CAUSES, ...CLIENT_READINESS, ...CLIENT_UNREADY_REASONS, ...SCOPE_CHANGE_KINDS]
      .map((o) => [o.key, o.label]),
  ),
};

/** Human label for a stored key, falling back to the key itself so a retired
 *  or unrecognised value shows as something rather than as a blank. */
export function closeoutLabel(key: string): string {
  return ALL_LABELS[key] || key;
}

/** Which way a scope change moved the day. `hours` is always a positive
 *  magnitude; this carries the sign. */
export type ScopeDirection = "added" | "saved";

export type ScopeChangeEntry = {
  /** One or more keys from SCOPE_CHANGE_KINDS. */
  kinds: string[];
  direction: ScopeDirection;
  /** Rough hours the change moved the day by, unsigned. Optional: logging that
   *  it happened matters more than pinning a number nobody can estimate at the
   *  tailgate. */
  hours?: number | null;
  note?: string;
};

/** The pre-2026-07-28 shape, still found in localStorage drafts written by a
 *  build the crew member has not refreshed past, and in server responses for
 *  reports saved before the change. */
type LegacyScopeChangeEntry = {
  kind?: string;
  kinds?: unknown;
  direction?: unknown;
  hours?: number | null;
  note?: string;
};

// The only reduction-flavored key that existed before the split, so it is the
// only legacy row that infers a "saved" direction.
const LEGACY_REDUCTION_KINDS = new Set(["reduced_scope"]);

/** Normalize one stored/queued scope change into the current shape.
 *
 *  Called on every read path (draft restore, server load) rather than at the
 *  point of render, so the rest of the component only ever sees `kinds[]`. */
export function normalizeScopeChange(raw: unknown): ScopeChangeEntry {
  const c = (raw || {}) as LegacyScopeChangeEntry;
  const kinds = Array.isArray(c.kinds)
    ? c.kinds.filter((k): k is string => typeof k === "string" && !!k)
    : c.kind
      ? [c.kind]
      : [];
  const direction: ScopeDirection =
    c.direction === "saved" || c.direction === "added"
      ? c.direction
      : kinds.some((k) => LEGACY_REDUCTION_KINDS.has(k))
        ? "saved"
        : "added";
  return {
    kinds,
    direction,
    hours: c.hours ?? null,
    note: c.note || "",
  };
}

export function normalizeScopeChanges(raw: unknown): ScopeChangeEntry[] {
  return Array.isArray(raw) ? raw.map(normalizeScopeChange) : [];
}

/** Normalize the variance answer, which was a single key before 2026-07-28.
 *  Accepts the list, the old bare string, or nothing. */
export function normalizeVarianceCauses(
  causes: unknown,
  legacySingle?: unknown,
): string[] {
  if (Array.isArray(causes)) {
    return causes.filter((c): c is string => typeof c === "string" && !!c);
  }
  return typeof legacySingle === "string" && legacySingle ? [legacySingle] : [];
}

/** Readiness values that mean something went wrong, so the follow-up question
 *  about what was not ready is worth asking. */
export function readinessNeedsDetail(readiness: string | null): boolean {
  return readiness !== null && readiness !== "" && readiness !== "fully_ready";
}
