# 0043 - The Bills materials line is appended BEFORE stale rows are dropped, and every rebuild is recorded before it is attempted

Date: 2026-09-03
Status: Accepted
Supersedes nothing. Extends [0041](0041-row-deletes-are-locked-and-re-read.md).

## Context

`rebuild_job_materials_total_in_bills` maintains one "Materials" line per job on
the Bills tab: sum every materials submission for the job, remove the previous
line, write a fresh one. It runs on every materials POST and DELETE.

ADR 0041 fixed the *race* between the read and the delete with a per-tab lock and
a re-read on a stale index. It did not touch two other ways the same row goes
missing, both found in the 2026-09-03 vet:

1. **The ordering.** The delete ran before the append. Render recycles this
   worker every 1000 requests by design and has OOM history, so "the process dies
   between these two calls" is not hypothetical - it is scheduled. When it
   happens, the job's materials charge does not exist on the Bills tab at all.
   The vetting protocol's own durability pass names this shape: delete-before-write
   fails it, write-then-delete-stale passes it.

2. **The bookkeeping.** The coalescer added in the previous change keeps its
   in-flight and pending-rerun sets in **process memory**. A rerun registered a
   moment before a recycle is gone, and a rebuild that raised was simply given up
   on. Nothing re-drove either. The Bills line kept whatever total it had until
   somebody happened to edit that job's materials again.

Both land on the one export whose output is money, and both are silent. An
under-billed job does not look like an error; it looks like a smaller job.

## Decision

**Append first, then delete every older row for the job except the bottom-most
one.** `_delete_sheet_rows_by_value` grows a `keep_last` flag that spares the
greatest matching grid index - the row just appended. A crash between the two now
leaves a visible duplicate instead of a hole. The duplicate is recoverable: it is
flagged by `sheet_integrity_check.py` and removed by the next rebuild of that
job, because `keep_last` keeps exactly one.

The row to spare is re-derived inside the retry callback, not passed in, so a
concurrent append cannot make a retry spare the wrong row.

**Record the intent in Postgres before attempting the work.** A
`sheet_generic_exports` row under `kind = 'bills_materials_pending'` is written
when a rebuild is scheduled and cleared only when one actually succeeds. A
rebuild that raises deliberately leaves its marker. `reconcile_job_materials_bills`
drains what is left from the auto-reconciler's fast cycle, which holds a **DB
lease** and therefore survives the recycle that lost the work in the first place.

The marker is cleared inside the coalescer lock. Released first, a `schedule()`
arriving in the gap would insert a fresh marker that the clearing DELETE then
removes, leaving pending work with no record of it.

`sheet_generic_exports` already exists for exactly this (kind, key) shape and is
created by `ensure_sheet_exports_tables` at boot, so none of this needs a
migration.

## Consequences

- A crash mid-rebuild costs a duplicate line, not a missing charge. That is the
  right direction to fail on an invoice: a duplicate is argued about, a missing
  line is paid.
- Re-driving needs no drift detection. The rebuild recomputes from Postgres and
  converges on one row, so a redundant run is free of consequence.
- One extra indexed write per materials POST/DELETE, and one indexed read per
  reconciler cycle that returns nothing in steady state.
- **Do not "tidy" the ordering back to delete-then-append.** It reads cleaner and
  it is the bug. The append must come first, and the delete must spare the last
  match.
- **Do not move the marker clear outside the lock** for the sake of not doing DB
  I/O while holding one. The lock is otherwise held for three set operations; the
  race it closes is the whole point.

## The guard that append-first makes necessary

Appending first has a cost the delete-first ordering did not have: a delete that
fails **deterministically** leaves the appended row behind, and the reconciler
re-drives the whole rebuild minutes later. Append, fail, append, fail. That is
precisely how the Reimbursements tab reached 189 duplicate rows and a $17,088
over-count in the 2026-08-05 audit - the dedupe delete no-oped and the caller
appended anyway, every time.

The realistic cause of a permanent delete failure is a header row that was
renamed or overwritten, which `_delete_sheet_rows_by_value` already raises
`SheetHeaderError` for. `rebuild_job_materials_total_in_bills` therefore checks
for the `submission_id` column **before it appends anything**, using the headers
`_ensure_tab` just returned, so the check costs no extra API call. A corrupted
header now fails loud and writes nothing, instead of piling up a row every five
minutes.

The residual case - a delete failing for some non-header reason - still
accumulates one row per reconciler cycle while it lasts, and self-heals on the
next success because `keep_last` keeps exactly one. `sheet_integrity_check.py`
flags the duplicates in the meantime.

## Known limit

This recovers work that was *recorded* and then lost. A rebuild whose marker
write itself failed is not covered, and neither is a Bills row damaged by
something other than a dropped rebuild. `sheet_integrity_check.py` remains the
backstop for both.
