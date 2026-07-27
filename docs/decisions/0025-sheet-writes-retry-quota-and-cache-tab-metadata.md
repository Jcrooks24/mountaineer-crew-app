# 0026. Sheet writes retry the quota, and tab metadata is cached

**Status:** Active. Added 2026-07-27 after the Advanced Settings system check
reported 11 of 19 syncs "need attention", two of them with
`HttpError 429 ... RATE_LIMIT_EXCEEDED`.

## Context

Google Sheets allows **60 read requests and 60 write requests per minute per
user**. The export path was spending that budget on bookkeeping rather than data:

- `_ensure_tab` issued a full `spreadsheets().get()` (metadata for every tab in
  the workbook) on **every** export, just to find out whether the tab existed.
- `_write_rows_top` issued a **second** full `spreadsheets().get()` on every
  export, to translate the tab name into a numeric `sheetId`.
- `_delete_sheet_rows_by_value` and `_sheet_numeric_id` each did the same again.

So one row reaching one tab cost 3-5 reads, of which at most one carried data.
A replace-style export that writes a summary plus item rows (estimates, BOLs,
job inventory) doubled that. A burst of crew syncing at end of day cleared 60
reads easily, and the burst is exactly when everyone syncs at once.

What made the 429 expensive was the failure handling, not the failure.
`_ssl_retry` only ever retried dropped TLS connections (`_SSL_ERRORS`); a 429
propagated out of the export, `record_sheet_sync` logged the failure, and the
row **was never written**. Nothing re-drove it. The data only reached the sheet
if a human happened to edit and re-save that record. That is a silent hole in
"synced data lands in the Google Sheet."

Estimates already carried a one-off bounded retry in `_estimate_export_worker`
(commit `de671f3`) for exactly this reason. That was the right instinct applied
to one sync out of nineteen.

## Decision

**1. Every Sheets request goes through `_api()`, which retries transient
failures.** `_api` classifies the exception:

- **quota** (HTTP 429/5xx, or `RATE_LIMIT_EXCEEDED` / `Quota exceeded` in the
  message) -> back off 5s, 15s, 30s. Long enough to actually clear a per-minute
  bucket.
- **ssl** (the existing `_SSL_ERRORS` markers) -> back off 0.5s, 1s, 2s. A
  dropped connection can be re-dialed immediately; making it wait 30s would
  stall exports that had nothing wrong with them.
- **anything else** -> re-raise immediately. A 400 (bad range, tab already
  exists) will never succeed on retry and must surface.

**Retry is per API request, never per export.** A request that returned 429 or
5xx did not apply, so re-issuing it is idempotent by construction. Retrying a
whole multi-step export would not be: the append-style writes would duplicate
rows if an earlier step had already succeeded.

**2. Tab metadata is cached for 30 seconds** (`_sheet_ids`), shared by
`_ensure_tab`, `_write_rows_top`, `_delete_sheet_rows_by_value` and
`_sheet_numeric_id`. The tab layout only changes when we create a tab, and
`_ensure_tab` calls `_invalidate_meta_cache` when it does.

Every consumer of the cache **re-reads live before acting on a miss or a
failure**, so a stale entry costs one extra read and never a wrong write:

- `_ensure_tab` confirms with `refresh=True` before creating a tab, so a stale
  "not there" can't produce a duplicate-tab 400.
- `_write_rows_top` refreshes before falling back to a bottom-append, and
  refreshes + retries once if `insertDimension` rejects a cached `sheetId`
  (tab deleted and recreated in the sheet gets a new id).
- `_delete_sheet_rows_by_value` refreshes before concluding the tab is absent.

**3. The health check reports current state, not history.** `check_sheets_sync`
now returns `failing` (the *last* attempt failed: `last_error_at` with no newer
`last_ok_at`), `never_synced` (no attempt ever), and `needs_attention`
(`failing`, or a missing tab for a sync that has run before). The panel counts
`needs_attention`.

## Consequences

- A crew sync that lands during a quota bounce now waits and writes, instead of
  being logged as an error and dropped.
- Reads per export drop from 3-5 to roughly 1 within the cache window, which is
  what keeps the bucket from filling in the first place. The retry is the safety
  net; the cache is the actual fix.
- Worst case a quota retry parks one of the two `_EXPORT_POOL` workers for ~50s.
  That is deliberate: exports are background, and a slow write beats a lost one.
  If throughput ever becomes the complaint, raise the pool size or coalesce the
  callers - do not shorten the backoff below the per-minute bucket.
- A tab an admin renames in the sheet can be acted on with stale metadata for up
  to 30s. Every path re-reads before it can do damage, so the cost is a retry.
- The system check went from flagging 11 of 19 syncs to flagging only what is
  currently broken. `Long-distance pay` and any future unused sync read
  "not yet" instead of red "missing".

## The backfill audit reads the sheet, not the marker table

The retry stops *new* losses. It does nothing for what the outages already left
behind, and `sheet_sync_status` cannot tell you what that is - one row per export
function means a later success for some other record overwrites the evidence. So
`sheet_backfill.py` compares the two sides directly and re-drives the real export
for whatever is missing.

There is an obvious cheaper way to do that, and it is wrong: `sheet_generic_exports`
already holds a per-record marker for nine of the syncs. A marker records that we
*believed* we wrote a row. If the write died after the marker was inserted, or a row
was later deleted by hand in the sheet, the marker lies - and it lies in the
dangerous direction, reporting a clean bill of health over a real gap. Reading the
tab's key column back costs one batched API call and cannot be wrong. **Do not
"optimize" the audit onto the marker table.**

Two further constraints worth keeping:

- **The audit is batched to a flat three Sheets calls** (metadata, all header rows,
  all key columns) no matter how many syncs are registered. A per-tab loop would be
  ~40 reads and would trip the very quota it exists to clean up after.
- **Re-export re-drives the production export path** for each record rather than
  writing rows itself. A backfilled row is therefore identical to a live one, and
  there is no second serializer to drift out of sync when a column is added.

## What would break if you undid this

- **Remove the 429 retry** and every quota bounce silently strands whatever was
  being written. It is invisible: the crew's device shows the submission synced,
  because the API returned 200 before the background export ran.
- **Remove the metadata cache** and reads-per-export triples, which is what put
  the account over 60/min to begin with. The retry alone would then be papering
  over a load problem it also makes worse (each retry is another read).
- **Cache without the `refresh=True` confirmations** and a stale entry becomes a
  wrong write: a duplicate-tab 400, or rows appended to the bottom of a tab that
  is supposed to read newest-first.
- **Go back to flagging any error ever recorded** and the panel is red
  permanently after the first transient failure of each sync. A monitor that is
  always red is a monitor nobody reads, which is worse than not having one - the
  point of the check is to notice the day a sync genuinely stops.
