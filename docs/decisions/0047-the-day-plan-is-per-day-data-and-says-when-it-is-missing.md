# 0047 - The day plan is per-day data, editable in place, and says when driving is missing

Date: 2026-09-10
Status: Accepted

**Driving scenario:** A crew lead called from an interstate job in Butte on the
morning of 2026-09-10, loading and driving that day with a second mover, and
reported the RODS recorder as missing: "because today we're loading and driving,
you know, that's how I set it up in the app. The issue with that that I'm seeing
is there's no option for rods logging when it's set up as that combination." His
screenshot showed `Doing: Packing, Loading` on the job-setup tile and the plain
Actions card below it. The Driving box was simply never ticked. He had read the
Long-distance trip toggle as meaning the job was a driving job, and the Actions
card was at that moment telling him "Driving is handled by the RODS on drive
days", which he reasonably took as the app having it covered. The owner
reproduced the same job on their own device with Driving ticked, got the RODS,
and could not reproduce the fault, so the call ended with the crew lead told to
delete and re-add his home-screen bookmark. Nothing was wrong with his install.

**User classes affected:** Crew lead and Mover, on long-distance jobs only. The
crew lead is the one who fills in job setup and the one who signs the RODS, so
they carry both halves of this. No admin-facing surface changes. Nothing on a
local job changes, since the day plan gates nothing there.

**Assumption this rests on:** That the crew read the trip toggle and the day
plan as one setting rather than two, and that naming the gap in place is enough
to separate them. If crews keep reaching a labor-only LD day while actually
driving, the assumption has failed, and the answer is to stop treating driving
as a checkbox and derive it from the job instead.

## Context

The RODS recorder is gated on `ldDriving`, the Driving entry in the day plan
(`crew_ld_plan_v1:<Mountain date>`). Two properties of that plan made the gate
easy to miss and hard to recover from:

1. **It is keyed by calendar day.** A five-day interstate trip needs the plan
   re-picked five times. That is correct: what the crew is doing genuinely
   changes day to day, and the drive-day flag it sets is what pays a per-diem.
2. **It only rendered inside the open setup form.** Once a job had a saved
   header the panel collapsed to a read-only tile, so on day two onward the
   picker sat behind an Edit button and a confirm dialog warning that the setup
   "feeds the DVIR, the job report, and the checklist for this job."

Separately, the copy on the labor-only branch was actively misleading. Reaching
that branch on a long-distance job means labor is picked and driving is not, and
the card said "Driving is handled by the RODS on drive days." That sentence is
true in general and wrong in exactly the state that renders it.

The two compound: a crew lead who does not tick Driving gets no RODS, gets told
the app has driving covered, and has no visible route back to the choice. A RODS
is a federal requirement on an interstate drive day, so the failure mode is a
missing legal record, not a missing convenience.

## Decision

- **The day plan is editable from the read-only setup tile.** The `Doing` row
  always renders, including when nothing is picked, and expands in place into
  the activity checkboxes. No confirm dialog and no Save: the toggles already
  persist on tap.
- **C2 from [ADR 0034](0034-a-job-has-a-header-record.md) is untouched, and the
  boundary is now written down.** C2 protects the header. The day plan is not
  header data: it never enters `body`, it is keyed by date rather than by job,
  and no tool seeds from it. **Per-day fields are editable in place; header
  fields stay behind confirm-to-edit.** That line is the rule for anything added
  to this tile later.
- **The labor-only long-distance card names the gap.** It states what the day is
  logged as, then asks directly: driving today, tick Driving in Job setup to
  bring up your RODS. The reassuring sentence is gone.

The alternative of nudging nobody and fixing only reachability was chosen first
and reversed the same session, once the screenshot showed the misleading string
sitting on the failing screen. Recorded here because the reversal is the useful
part: reachability was never what bit this crew lead, since the Driving box was
on screen when he ticked Packing and Loading. Comprehension was.

Carrying the previous day's plan forward was considered and rejected: it removes
the taps but asserts a drive day nobody confirmed, and that flag pays money.

## Consequences

- A crew member on day two of a trip changes today's activities in two taps from
  the hub, instead of reopening a form behind a warning dialog.
- The labor-only LD state is now self-explaining, which is the state crews land
  in when they think the trip toggle covers driving.
- `Doing: Not picked yet` now shows on local jobs too, where the plan gates
  nothing. Accepted as the cost of the row being reliably tappable.
- This ships to `staging` only. Production last shipped 2026-08-13, so the crew
  lead who reported it keeps seeing the old behavior until a promotion.
