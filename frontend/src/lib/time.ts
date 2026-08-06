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
// inspection_date) - those are date-only fields the user typed and don't
// have a timezone to interpret in the first place.

const MOUNTAIN_TZ = "America/Denver";

type DateInput = string | number | Date | null | undefined;

function asDate(input: DateInput): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "08:08 AM" - wall-clock hour and minute in Mountain. */
export function formatMountainTime(input: DateInput): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleTimeString([], {
    timeZone: MOUNTAIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "5/1/2026" - calendar date as it falls in Mountain. */
export function formatMountainDate(input: DateInput): string {
  const d = asDate(input);
  if (!d) return "";
  return d.toLocaleDateString([], { timeZone: MOUNTAIN_TZ });
}

/** "5/1/2026, 08:08 AM" - date + time, both in Mountain. */
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

/** "YYYY-MM-DD" of the calendar date as it falls in Mountain - the form
 *  used in localStorage, sheet `job_date`, and `<input type="date">` values.
 *
 *  Critical for crew working past 5 PM Mountain: a naive `.toISOString()
 *  .slice(0, 10)` returns the *UTC* date and would file 11 PM Mountain
 *  events under tomorrow's calendar date. Always go through this helper
 *  for any "what day did this happen?" derivation.
 *
 *  Defaults to "today" when called with no args. */
export function mountainDateYYYYMMDD(input: DateInput = new Date()): string {
  const d = asDate(input);
  if (!d) return "";
  // en-CA's default short date format is YYYY-MM-DD, so combined with the
  // timeZone option this gives us the Mountain calendar date directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOUNTAIN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "HH:MM" 24-hour wall-clock in Mountain - the internal-key analogue of
 *  `mountainDateYYYYMMDD`, for STORED duty-change / shift times that must match
 *  the Mountain-pinned backend regardless of the device's timezone. Do not use
 *  device `getHours()` on a payroll path; a phone in Central would shift every
 *  recorded time +1h. Defaults to now. */
export function mountainHHMM(input: DateInput = new Date()): string {
  const d = asDate(input);
  if (!d) return "";
  // en-GB + hour12:false gives 24-hour "HH:MM" with "00:00" (not "24:00") at midnight.
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MOUNTAIN_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
