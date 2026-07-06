// Fixed job-type vocabulary (multi-select) + the truck roster and fullness
// steps. Mirrored on the backend in backend/app/schemas/job_report.py
// (JOB_TYPE_TAGS / TRUCK_IDS / FULLNESS_STEPS) - keep the lists in sync.

export const JOB_TYPE_TAGS = [
  "Local",
  "Long-distance",
  "Labor-only",
  "Packing",
  "Unpacking",
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

export type TruckFullnessEntry = {
  truck: string;
  vertical_pct: number;
  horizontal_pct: number;
};
