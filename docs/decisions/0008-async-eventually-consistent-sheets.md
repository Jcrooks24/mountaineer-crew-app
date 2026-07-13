# 0008. Sheets export is asynchronous and eventually consistent

**Status:** Active.

## Context

Every domain write needs to be mirrored into the Google Sheet, because that is what
the office reads. The naive approach is to write to Postgres and then call the
Sheets API before returning the response.

That couples every crew action to Google's availability and latency. A slow Sheets
call becomes a slow clock-in. A Sheets outage becomes a total app outage for people
standing in a driveway. That trade is unacceptable: **Postgres is the system of
record, the Sheet is a mirror of it.** The mirror must never be able to take down
the thing it mirrors.

## Decision

Three layers:

1. **Postgres is written synchronously.** The request succeeds or fails on that
   alone.
2. **The Sheets export is handed to a 2-thread pool** (`run_export_in_background`)
   and the request returns immediately. Export failures are logged, not raised.
   Exports are deduped through the `sheet_*_exports` tables so a row is never
   double-written.
3. **An auto-reconciler thread runs every 300 seconds**, finds events that exist in
   Postgres with no export record, and pushes them. It holds a Postgres advisory
   lock so only one worker reconciles even with multiple instances running.

## Consequences

- **A row missing from the Sheet for a few minutes is normal, not a bug.** Wait five
  minutes before investigating. This is the first line of the Sheets runbook for a
  reason.
- A Google outage costs nothing permanent. Once access returns, the reconciler
  backfills.
- **The reconciler currently covers events only.** Other record types rely on the
  export firing at write time. If one of those fails and is never retried, it stays
  missing until the record is re-saved. Extending the reconciler to cover the other
  types would be a genuine improvement.
- The `_EXPORT_POOL` is process-wide with 2 workers. It is small on purpose: this
  runs on a 512 MB instance (see [0002](0002-render-start-command.md)).

## What would break if you undid this

Making the export synchronous puts Google's uptime and latency directly in the path
of a crew member clocking in on one bar of signal. The app's core promise is that it
keeps working when the network is bad. Do not put a third-party API call on the
critical path of a field write.
