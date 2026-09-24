# 0055 - A rental truck is entered once, and offered in the truck list

Date: 2026-09-24
Status: Accepted. Amends [0053](0053-a-rental-is-a-placeholder-and-the-job-records-which-truck-it-was.md).

**Driving scenario:** in the owner's words and the rules they set, in
[PRD.md, Vehicle and DVIR: rental trucks](../PRD.md#vehicle-and-dvir-rental-trucks).
In short: two rentals out at once could not be told apart, and a multi-day job
re-entered the same truck.

**User classes affected** (owner-confirmed 2026-09-24): **mover / driver**, who
enters the truck at the pre-trip inspection and picks it on later days. **Crew
lead**, who often collects the rental and enters or picks it. **Office admin**,
who enters it at booking when known and reads the records. The systems owner was
not selected.

**Assumption this rests on:** that a rented truck's plate is stable for as long
as the company has the truck, so the plate can be the thing that matches two
entries of the same truck and the thing an inspection history keys on. If a
rental's plate can change mid-rental (a swapped truck under the same agreement),
the match-by-plate rule is what to reopen.

## Context

ADR 0053 made the rented truck's identity (plate, company, agreement, GVWR) a
block on the job header, one per job, entered at job setup. Two things were left:

- The truck options still read "rental" for every hired truck, so with two out at
  once nobody could tell which was theirs.
- A truck that served several days or several jobs was typed again every time,
  because the identity belonged to a job, not to the truck.

Intake also moved where the truck is entered. The owner: entered "as soon as it
becomes relevant to do so (presumably during a pre trip DVIR)". In the 0053 build
the DVIR could only read the plate from the job header, and told the driver to go
and add it there.

On 2026-09-24 the owner ruled on the one line of 0053 this crosses: *"a driver
still cannot invent a registry entry, and no longer needs to."* Crew can now create
rental truck records that appear in the truck list. The fleet registry itself is
still admin-only; a rental record is not a registry entry.

## Decision

1. **A rental truck is its own record** (`rental_trucks`), keyed by a
   client-generated `rental_uuid`, holding plate, company, agreement number, GVWR,
   notes, and the registry placeholder it stands behind. Any signed-in user can
   create one.

2. **It is entered wherever it first matters**, usually the pre-trip DVIR
   ("+ New rental truck" in the unit list), or the job header. Both go through one
   server path (`app/core/rental_trucks.py`). The DVIR creates the truck and its
   job link **in the same transaction as the report**, so neither can land
   without the other.

3. **Each job it serves is a link** (`rental_truck_jobs`), with who linked it,
   when, and from which screen. Linking to a new job does not wait for the prior
   job to close out (owner's choice). The RentalTrucks worksheet lists every job
   per truck.

4. **The truck list shows live rentals as "Rental*<job name>"**, the job being the
   most recent link (owner's choice). Job names are not unique, so when two listed
   trucks would read the same, the plate is shown beside the label.

5. **A rental leaves the list** when someone marks it returned (a post-trip DVIR
   checkbox, or a button on the job header), or **10 days after it was last used**.
   "Used" means inspected **or** linked to a job. The owner's option said "after
   its last inspection"; counting a link too means a truck entered at booking,
   before anyone inspects it, does not drop out of the list before the job starts.
   The record and its history are never deleted.

6. **The header reads the truck from the links.** `GET /api/job-setup` answers
   `rental` from the most recent linked truck (falling back to 0053's
   `rental_json` for older headers), so a truck entered at the inspection reaches
   the header, the RODS and the BOL with no second entry. For a job with no header
   yet, the RODS and BOL ask `/api/rentals/for-job` directly.

## The rules that keep one truck one record

These are the parts someone will be tempted to simplify.

- **Match by plate among trucks not yet returned.** A second entry of the same
  plate (another phone, a retried submit with a new id, the header and the DVIR
  both creating it offline) joins the live record instead of creating a second.
  Plates are compared ignoring case, spaces and dashes. A returned truck rented
  again later is a **new** record, because it is a new rental; its inspection
  history still joins up, because ADR 0053 keys that on the plate.
- **Details only fill in.** A later write never blanks a field. The header can be
  a stale queued copy from hours ago; letting it blank the GVWR someone typed at
  the truck would be silent loss.
- **A save never unlinks.** A header saved without its rental block leaves the
  link in place. Removing a wrong pick is its own explicit action, and it is
  refused once an inspection on that job was filed against the truck: then the
  link is the record of which truck did the work.
- **The plate is fixed once an inspection is filed against the truck.** The
  prior-report review and the out-of-service lockout key on it (0053), so
  changing it would split one truck's inspection history into two. The rentals
  endpoint refuses with 409. The job header does not: refusing the whole header
  over its rental block would strand crew, route and notes edits in the offline
  queue, so the header save goes through and the inspected plate stands.
- **The DVIR still snapshots.** It copies the record's merged details onto its own
  row (so a GVWR entered earlier at job setup reaches a report whose form left it
  blank) and stores `rental_uuid` as a link for lookup only. Editing the record
  never rewrites a past report.

## Alternatives not taken

- **Keep the identity on the job header only**, with a DVIR form that writes back
  to it. Cheaper, but a truck used on two jobs is entered twice and there is no
  per-truck record, which is the second half of the scenario.
- **Let crew write the fleet registry.** Least code, but the registry would fill
  with trucks already handed back, admin would lose sole control of it, and the
  placeholder design in 0053 would be thrown away.

## Consequences

- One truck, one record, one row on the RentalTrucks tab, with every job it served.
- New env var `SHEETS_RENTAL_TRUCKS_TAB` (`RentalTrucksStaging` on staging). Unset
  falls back to the production tab.
- The header holds **one** rental. A job running two rented trucks at once can
  link both through their inspections, but the header shows and edits only the
  most recent. Recorded as an open question in the PRD, not decided here.
- Marking a truck returned and removing a wrong pick need signal. Both only hide
  or correct, so nothing is lost by doing them later.
- Nothing works until an admin ticks **This is a rental placeholder** on the
  registry's rental entry, the same prerequisite as 0053.

## What would break if you undid this

**If you drop the plate match in `upsert_rental`:** every retried or duplicated
entry creates another record, the list shows the same truck twice, and its jobs
split between them. Nothing errors.

**If you let a write replace fields instead of filling them:** a stale header
save quietly blanks the GVWR, the one record of whether federal rules reached the
trip.

**If you make the header save unlink trucks it does not mention:** a queued
offline header from before the inspection erases the link the inspection made.

**If you allow a plate change after an inspection:** the truck's next inspection
cannot see its last one, and an open defect stops locking it out.

Guarded by `backend/scripts/verify_rental_truck_records.py`, 43 checks against
the real routes on a throwaway SQLite database.
