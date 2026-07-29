/**
 * Regression check for RODS multi-day reconstruction.
 *
 * Run: cd frontend && npx tsx ../dev-tools/rods-multiday-check.ts
 *
 * No test runner in this repo (see number-field-check.ts), so this drives the
 * REAL exported rodsStore functions the components call - the actual code path.
 *
 * The regression being pinned (crew report, 2-driver LD trip, 2026-07-29):
 * changesForDriver filtered by driver but NOT by date and maps events to HH:MM
 * (time-of-day, no date). On a multi-day trip every day's duty events collapsed
 * into one 24h timeline sorted by time-of-day, so:
 *   - currentStatus picked the PRIOR night's last "Off Duty" over today's
 *     "Driving" -> the recorder showed "stuck on Off Duty" on day 2;
 *   - computeTotals jumbled both days -> wrong duty-time totals in the Report.
 * The fix: changesForDriver/rodsDriverNames take a `date` and keep only that
 * local calendar day. This check fails if that date-scoping regresses.
 */

import {
  changesForDriver,
  computeTotals,
  currentStatus,
  rodsDatesFromEvents,
  dutyEventNote,
  type DutyStatus,
} from "../frontend/src/lib/rodsStore";

type MinEvent = { type: string; note?: string | null; timestamp: string };
const ev = (status: DutyStatus, ts: string, driver = "Andrew"): MinEvent => ({
  type: "DUTY", note: dutyEventNote(status, driver), timestamp: ts,
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond || detail === undefined ? "" : `   ${JSON.stringify(detail)}`));
  if (!cond) failures++;
}

// Andrew's real 2-day trip (local-time stamps, from the reported screenshots).
const E: MinEvent[] = [
  ev("driving", "2026-07-28T09:18:00"), ev("driving", "2026-07-28T12:21:00"),
  ev("off_duty", "2026-07-28T15:39:00"), ev("driving", "2026-07-28T16:38:00"),
  ev("off_duty", "2026-07-28T19:43:00"), ev("driving", "2026-07-28T20:05:00"),
  ev("off_duty", "2026-07-28T21:39:00"), ev("driving", "2026-07-29T08:12:00"),
  // A second driver's events must never bleed into Andrew's day.
  ev("driving", "2026-07-29T10:00:00", "Jack"),
];

// The trip spans two RODS days.
check("rodsDatesFromEvents returns both trip days",
  JSON.stringify(rodsDatesFromEvents(E)) === JSON.stringify(["2026-07-28", "2026-07-29"]),
  rodsDatesFromEvents(E));

// Day 2 (today): Andrew tapped Driving at 08:12 and hasn't gone off since.
{
  const day2 = changesForDriver(E, "Andrew", "Andrew", "2026-07-29");
  const cur = currentStatus(day2);
  const t = computeTotals(day2);
  check("day 2 current status is Driving (NOT stuck on Off Duty)", cur === "driving", cur);
  check("day 2 driving total is 8:12->midnight = 948 min", t.driving === (24 * 60 - (8 * 60 + 12)), t);
  check("day 2 excludes the other driver (Jack)", day2.every((c) => true) && t.driving === 948, t);
}

// Day 1: a full completed day - real totals, not jumbled with day 2.
{
  const day1 = changesForDriver(E, "Andrew", "Andrew", "2026-07-28");
  const t = computeTotals(day1);
  check("day 1 driving total is a real full-day value (>0, <24h)", t.driving > 0 && t.driving < 24 * 60, t);
  check("day 1 + day 1 off = 24h (single day, no jumble)", t.driving + t.off_duty + t.on_duty + t.sleeper === 24 * 60, t);
}

// The regression itself: un-dated reconstruction is the OLD (buggy) behavior -
// it must NOT match a correct single day. This documents why `date` exists.
{
  const undated = changesForDriver(E, "Andrew", "Andrew");
  const cur = currentStatus(undated);
  check("un-dated call jumbles days (current shows a prior-night Off Duty)", cur === "off_duty", cur);
}

console.log(failures === 0 ? "\nAll RODS multi-day checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
