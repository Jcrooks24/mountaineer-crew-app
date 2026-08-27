# 0041 - Row deletes hold a per-tab lock and re-read on a stale index

Date: 2026-08-27
Status: Accepted

## Context

Every replace-style Sheet export does the same three steps: read a key column,
work out which grid row indices match, delete them bottom-up. The read and the
delete are two separate API calls, and between them the grid can move.

It does move. The export pool runs `max_workers=2`, the backfill drives exports,
and the auto-reconcile sweep drives more. A delete on the same tab from any of
them shifts every index the other one just computed, and Sheets rejects the whole
batch:

```
Invalid requests[0].deleteDimension: Cannot delete a row that doesn't exist.
Tried to delete row index 1372 but there are only 1372 rows.
```

`_api` does not treat that 400 as transient, which is correct - replaying the
same stale indices fails identically. So the export died there.

On 2026-08-27 the failure ring held 37 of these in one day, every one of them
`rebuild_job_materials_total_in_bills`. That function deletes the job's old
"Materials" line and then appends a fresh one carrying the new total. Sheets
applies a rejected batch atomically, so nothing was deleted and nothing was
appended: **the job's materials total in Bills stayed frozen at its previous
value**, with no gap in the sheet to notice. An office reading Bills to invoice
saw a number that looked fine and was stale.

The same race produces the opposite symptom elsewhere. A write-first-then-delete-
stale export (BOLs, ADR 0020) that loses the race keeps its old rows, which
surfaces as a duplicate in the nightly integrity check. Missing records and
duplicated records were the same defect wearing two hats, decided by nothing more
than which order that particular export happened to use.

## Decision

All five index-based row deletes go through one helper, `_delete_rows_matching`,
which applies two defences.

### 1. A per-(spreadsheet, tab) lock, held across the read AND the delete

This closes the window between the two export threads, which is where nearly all
of it comes from. The lock is per tab, not global: exports on unrelated tabs have
no reason to wait on each other, and with only two pool threads a global lock
would serialize the pool outright.

The lock dict is bounded and pruned the same way the per-event locks are. It is
keyed by worksheet, so it holds dozens of entries, not thousands - the cap is
sized for growth, not for volume.

### 2. One re-read-and-retry on exactly that 400

A lock in this process cannot stop the cron, the backfill in another worker, or
an admin editing the sheet by hand. Re-reading is the only correct response to
"your indices are stale", so the helper re-invokes the caller's `find_indices`
and rebuilds the batch. That is why `find_indices` is a callable and must do its
own reading rather than close over values read earlier - handing it a stale list
to replay would reproduce the bug inside the fix.

After the retry budget it raises. A delete that cannot be made to land is a real
failure and belongs in the failure ring, not swallowed.

## Consequences

- Deletes on a busy tab now wait for each other. This is intended. The cost is
  latency on a background export; the thing it buys is that the export completes.
- The retry costs one extra column read, and only on a lost race.
- `backend/scripts/test_row_delete_race.py` reproduces the race against a fake
  grid, with no credentials and no network. A live smoke test cannot catch this
  class: run serially against a real sheet, the buggy code passes.

## What NOT to do

**Do not classify this 400 as transient inside `_api` instead.** `_api` retries a
single request as-is, which is safe precisely because a 429 or a 5xx did not
apply. Re-issuing a rejected `deleteDimension` batch with the same indices is not
the same thing: the indices are the problem, and by the time the retry runs they
may have become valid again pointing at *different rows*. That deletes live data.
The re-read has to happen outside the request, which is why this helper exists at
all.

**Do not drop the lock now that the retry exists.** The retry is the fallback for
writers this process cannot see. Leaning on it for the in-process case would mean
paying an extra read-and-round-trip on a large share of exports, and turning a
race we can simply prevent into one we merely survive.
