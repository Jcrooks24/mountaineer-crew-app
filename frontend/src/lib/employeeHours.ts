// Shared employee-hours types + billing math. Kept in lib/ (not inside
// JobReport.tsx) so BillCalculator can consume them without an import
// cycle back into its own parent.

// Mirrors backend EmployeeHoursEntry. `hours` is the actual worked time;
// the company billable total rounds quarter-by-quarter at display + sheet-
// export time. `non_billable` rows show in the table but contribute 0 to
// total man-hours and are excluded from the Bill Helper autopopulate.
export type EmployeeHoursEntry = {
  // Roster user id. THIS is the match key the worked-hours summary joins on, so a
  // rename or a nickname no longer detaches somebody from their own hours. Absent
  // on legacy rows written before the roster was required, which the server still
  // falls back to matching by name.
  user_id?: number;
  name: string;
  start: string;
  end: string;
  // Mountain "YYYY-MM-DD" of the shift START. Lets payroll book a multi-day job's
  // hours into the correct pay period per day. Absent on legacy rows -> payroll
  // falls back to the job's earliest-event date (unchanged behavior).
  date?: string;
  break_hours: number;
  hours: number;
  non_billable?: boolean;
  // Long-distance: this employee was out of town this day → $50 per-diem.
  out_of_town?: boolean;
  // Legacy single overall skill rating (1–5). Superseded by skill_ratings
  // below; kept so old reports still hydrate. Display-only.
  skill_rating?: number | null;
  // Per-skill ratings for this mover on this job, keyed by skill name. Only the
  // skills relevant to the job's type(s) are shown to rate. 0-5 (or 0/5 for
  // binary skills). Display-only - never affects the man-hours math.
  skill_ratings?: Record<string, number> | null;
};

// Company billing rule: round to the next quarter-hour if the worked time
// is ≥5 minutes into the current quarter; otherwise round down to that
// quarter. Mirrored on the backend (_round_billable_quarter in
// sheets_export.py) so the spreadsheet and the UI agree.
export function roundBillableQuarter(hours: number): number {
  if (hours <= 0) return 0;
  const totalMin = Math.round(hours * 60);
  const quarters = Math.floor(totalMin / 15);
  const remainder = totalMin - quarters * 15;
  const roundedMin = remainder >= 5 ? (quarters + 1) * 15 : quarters * 15;
  return roundedMin / 60;
}

// Default hourly labor rate used when man-hours are auto-populated into
// the Invoice Builder. Editable on the line-item once created.
export const DEFAULT_LABOR_RATE = 80;
