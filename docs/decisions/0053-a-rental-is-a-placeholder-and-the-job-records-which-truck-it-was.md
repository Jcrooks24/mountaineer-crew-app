# 0053 - A rental is a placeholder, and the job records which truck it was

Date: 2026-09-17
Status: Accepted

**Driving scenario:** The owner at intake, 2026-09-17, describing current practice
and what it costs. Two things go wrong today, and they chose both:

> "Our inspection reports, duty logs and bills of lading all record the vehicle as
> 'rental'. If anyone asks which truck a record refers to, nothing in the app can
> answer, because the plate and agreement number were never captured."

> "Whether federal rules applied to a trip depends on the truck's weight rating,
> and we never record it. For a rental we cannot show afterwards whether the truck
> was over or under the threshold."

The practice that produces this: **"admin or sometimes crew drivers pick up trucks.
current practice is using a generic 'rental' in the crew app to designate the
rental."** Every long-distance trip runs in a rented truck.

**User classes affected** (owner-confirmed 2026-09-17): **mover and driver**, who
pick up rentals and file the pre-trip inspection, and who get blocked or misled by
a shared inspection history. **Crew lead**, likely collecting a rental for an early
departure and entering its details. **Office administrator**, who reads the records
and is who an auditor's question lands on. **Systems owner**, who also collects
rentals and maintains the registry.

**Assumption this rests on:** That the plate or unit number is knowable and
readable at pickup, so requiring it does not strand a driver at a truck they cannot
inspect. If a rental ever arrives without a legible identifier, the DVIR guard is
what to reopen, not to weaken quietly.

## Context

The generic "rental" registry entry was a sensible workaround for a real problem.
The DVIR vehicle field is a closed select fed from the fleet registry, the registry
is admin-only to write, and a driver at an unregistered truck cannot add it. A
standing placeholder meant a report could always be filed. That is B-05 from the
2026-09 gap audit, and the workaround solved it.

The workaround then caused a worse problem, which is B-19.

**One name, three federal records.** The job header's first vehicle unit seeds the
RODS vehicle number (`RodsSignoff.tsx`) and the BOL vehicle (`BillOfLadingForm.tsx`),
and the DVIR stores it directly. So all three recorded the vehicle as the word
"rental". A grep of the entire codebase for VIN, licence plate, rental agreement or
rental company returned nothing: the registry entry name was the only vehicle
identifier that existed anywhere.

**One name, one shared inspection history.** The §396.13 prior-report review and the
out-of-service lockout both key on `vehicle_number`. With every rental under one
name, a driver picking up a truck is shown the previous, unrelated rental's report
and asked to confirm *this* vehicle is safe. Worse in both directions: an unresolved
defect on a truck handed back weeks ago refuses to let anyone inspect a different
truck, and a clean report on that old truck clears a genuinely defective one.

**No weight rating anywhere.** The registry seeds units name-only with every numeric
field null, deliberately, so no stale hardcoded weight can drift. For a rental there
was nowhere to record the real truck's GVWR, which is the number that decides whether
federal rules reached the trip at all (V-1 in the compliance reference).

## Decision

**The registry entry stays a placeholder. The job records which truck it stood for.**

1. **A registry entry can be flagged `is_rental`**, set by an admin in Settings. It
   means "this stands for whatever we hired", not "one truck we own". Absent means
   not a rental, so every existing entry is unaffected.

2. **The job header gains a rental block**: company, agreement number, **plate**,
   GVWR, notes. It appears only when a selected unit is flagged as a rental, and
   clears when that unit is deselected.

3. **The plate is what reaches the records.** The RODS and BOL seed their vehicle
   from it in preference to the unit name, so those documents name the truck.

4. **The DVIR snapshots the identity onto its own row** rather than pointing at the
   header, so a report stays true to the truck it inspected even if the header is
   edited afterwards. `vehicle_identifier`, `rental_company`, `rental_agreement` and
   `gvwr_lbs`, all carried to the DVIRs worksheet as their own columns.

5. **A rental DVIR without a plate is refused**, server-side with a 400 and in the
   form before that. Without it the report cannot say which vehicle it is about and
   cannot be scoped afterwards.

6. **The prior-report review and the lockout are scoped to the actual truck.** They
   key on `(vehicle_number, vehicle_identifier)` for a rental. A rental with no
   identifier gets **no** prior report rather than some other rental's, because
   answering with the wrong truck's report is the bug. Owned units are untouched:
   the name is the truck, no identifier is passed, the query is unchanged.

7. **Unknown units are not treated as rentals.** A name the registry has never heard
   of is a data problem; refusing the inspection would be the app deciding a truck
   cannot be inspected at all.

Guarded by `backend/scripts/verify_rental_truck_identity.py`, 22 checks, no database
needed.

## Consequences

- An inspection report, a duty log and a bill of lading each name the truck they are
  about.
- Each physical rental keeps its own inspection history. The cross-contamination in
  both directions is gone.
- The GVWR is recorded per job, which is the first time the app can answer whether a
  given trip was over the federal threshold. That closes the capability half of B-06.
- B-05 is closed as **accepted, by design**: a driver still cannot invent a registry
  entry, and no longer needs to. The placeholder plus a plate is the supported path.
- Rows written before this carry no identifier. They are left alone. Inventing a
  plate for a past inspection would be worse than a record that is honest about what
  was captured.
- One more field to fill at job setup on a rental job. That is the cost, and it is
  paid by the person who has the rental agreement in their hand.

## What would break if you undid this

**If you drop `vehicle_identifier` from the prior-report query:** it looks like a
redundant filter, and removing it silently re-merges every rental into one shared
inspection history. Nothing errors. A driver gets locked out by a defect on a truck
the company no longer has, or waved through on a clean report for a different truck.
This is the regression the verify script exists to catch.

**If you make the plate optional to "unblock" a driver:** the report stops
identifying the vehicle, and it can never be scoped afterwards, because nothing else
on the row says which truck it was. The fix for a driver who cannot read a plate is
to decide what to capture instead, not to let the field be empty.

**If you point the DVIR at the job header instead of snapshotting:** editing the
header afterwards silently rewrites the vehicle on every past inspection filed under
that job. An inspection record has to stay true to the truck that was inspected.

**If you drop the `is_rental` flag and treat every unit as a rental:** owned trucks
would start demanding a plate they do not have, and the registry name that already
identifies them would stop being enough.
