// Fixed job-type vocabulary (multi-select) + the truck roster and fullness
// steps. Mirrored on the backend in backend/app/schemas/job_report.py
// (JOB_TYPE_TAGS / TRUCK_IDS / FULLNESS_STEPS) - keep the lists in sync.

// Move TYPE only. Trip (Local/Long-distance) is the setup's LD toggle and the
// day's tasks (Packing/Unpacking/Loading/Unloading/Driving) are the "what are
// you doing today?" activities - those are NOT job types (they'd be logged
// twice). See TRIP_TASK_TAGS in JobSetupPanel.
export const JOB_TYPE_TAGS = [
  "Labor-only",
  "Commercial",
  "Delivery",
  "Storage",
] as const;

export type JobTypeTag = (typeof JOB_TYPE_TAGS)[number];

// The four trucks; a fullness reading is captured per truck used on the job.
export const TRUCK_IDS = ["16Ford", "26Int", "24FR8", "26FR8"] as const;

export type TruckId = (typeof TRUCK_IDS)[number];

// Crew estimates fill against the interior 25% marks in each dimension.
export const FULLNESS_STEPS = [25, 50, 75, 100] as const;

// ── Truck interior dimensions ───────────────────────────────────────────────
// Used ONLY to turn a fill percentage into a cubic-foot readout on the job
// report, so crew can learn what a given fill actually means in volume. Nothing
// bills off these numbers.
//
// ** These are estimates from the box length and typical interior width/height.
// Measure the real fleet and correct them. ** Changing a number here changes the
// cubic feet shown on NEW readings; it does not rewrite reports already
// submitted, because what gets stored is the percentage the crew observed and
// the cubic feet are derived from it at display time. That is deliberate: the
// percentage is the observation, the volume is an interpretation of it.
//
// Mirrored on the backend in backend/app/schemas/job_report.py (TRUCK_SPECS) so
// the sheet shows the same number the crew saw. Keep the two in sync.
export const TRUCK_SPECS: Record<string, { length_ft: number; width_ft: number; height_ft: number }> = {
  "16Ford": { length_ft: 16, width_ft: 7.5, height_ft: 7.0 },
  "26Int": { length_ft: 26, width_ft: 8.0, height_ft: 8.5 },
  "24FR8": { length_ft: 24, width_ft: 8.0, height_ft: 8.5 },
  "26FR8": { length_ft: 26, width_ft: 8.0, height_ft: 8.5 },
};

// A rental has no entry above; crew types its length and we assume a standard
// box interior for the other two dimensions.
export const RENTAL_INTERIOR = { width_ft: 8.0, height_ft: 8.0 };

/** Total interior volume for an entry, or null when we can't know it (a rental
 *  whose length the crew hasn't entered). */
export function truckCapacityCuFt(entry: {
  truck: string;
  is_rental?: boolean;
  length_ft?: number;
}): number | null {
  if (entry.is_rental) {
    const len = entry.length_ft;
    if (!len || len <= 0) return null;
    return Math.round(len * RENTAL_INTERIOR.width_ft * RENTAL_INTERIOR.height_ft);
  }
  const spec = TRUCK_SPECS[entry.truck];
  if (!spec) return null;
  return Math.round(spec.length_ft * spec.width_ft * spec.height_ft);
}

/** Combined fill percentage: the deck is filled `horizontal_pct` deep and
 *  `vertical_pct` high, so the loaded fraction is the product. */
export function combinedFillPct(vertical_pct: number, horizontal_pct: number): number {
  return Math.round((vertical_pct * horizontal_pct) / 100);
}

/** How many times this truck was filled. Missing, zero and nonsense all read as
 *  1: an entry that predates the field described a single load. */
export function loadCount(entry: { loads?: number }): number {
  const n = Number(entry.loads);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Cubic feet loaded ACROSS ALL LOADS, or null when capacity is unknown.
 *
 *  A truck that ran twice moved roughly twice the volume, and this figure feeds
 *  the weight estimate, so multiplying here is the whole point of recording
 *  loads. A single-load entry is unaffected, which is every entry written before
 *  the field existed. */
export function filledCuFt(entry: {
  truck: string;
  vertical_pct: number;
  horizontal_pct: number;
  is_rental?: boolean;
  length_ft?: number;
  loads?: number;
}): number | null {
  const cap = truckCapacityCuFt(entry);
  if (cap === null) return null;
  const perLoad = (cap * combinedFillPct(entry.vertical_pct, entry.horizontal_pct)) / 100;
  return Math.round(perLoad * loadCount(entry));
}

export type TruckFullnessEntry = {
  truck: string;
  vertical_pct: number;
  horizontal_pct: number;
  /** How many times this truck was filled and emptied on the job. Optional and
   *  absent on every entry written before it existed, which is why every reader
   *  treats missing as 1 - that is what those entries meant. */
  loads?: number;
  // Rental trucks aren't in the fixed fleet: free-text label + optional length,
  // and their fill is a best guess since they have no interior 25% markers.
  is_rental?: boolean;
  length_ft?: number;
};
