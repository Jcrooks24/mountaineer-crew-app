// Centralized time formatting for the crew app.
//
// All event/system timestamps render in Mountain time (America/Denver,
// Bozeman) regardless of the viewing device's timezone. Crew use the app
// in Bozeman; admins reviewing on a laptop in another timezone (or with
// a misconfigured device clock) need to see the same wall-clock time the
// crew saw, otherwise event ordering and shift logs read inconsistently.
//
// Use these helpers any time you display a server-or-event timestamp.
// Do NOT use them for user-picked calendar dates (job_date, move_date,
// inspection_date) — those are date-only fields the user typed and don't
// have a timezone to interpret in the first place.

const MOUNTAIN_TZ = "America/Denver";

type DateInput = string | number | Date | null | undefined;

function asDate(input: DateInput): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "08:08 AM" — wall-clock hour and minute in Mountain. */
export function formatMountainTime(input: DateInput): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleTimeString([], {
    timeZone: MOUNTAIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "5/1/2026" — calendar date as it falls in Mountain. */
export function formatMountainDate(input: DateInput): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleDateString([], { timeZone: MOUNTAIN_TZ });
}

/** "5/1/2026, 08:08 AM" — date + time, both in Mountain. */
export function formatMountainDateTime(input: DateInput): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleString([], { timeZone: MOUNTAIN_TZ });
}

/** Pass-through for callers needing a custom shape (e.g. "May 1, 08:08").
 *  Always pins to Mountain regardless of the options object. */
export function formatMountain(
  input: DateInput,
  opts: Intl.DateTimeFormatOptions = {},
): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleString([], { timeZone: MOUNTAIN_TZ, ...opts });
}
