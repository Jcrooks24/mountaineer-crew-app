# 0024. A BOL guards against being overwritten by a second crew/truck

**Status:** Active. Added 2026-07-27 after a field report: a job ran with two
trucks, and the question was whether the crew could accidentally create a second
BOL or blank the first truck's inventory.

## Context

[ADR 0018](0018-bol-is-one-document-per-job.md) established one BOL per job:
`bol_id = bolIdForJob(job_uuid)`, so every device converges on the same document,
and `loadForJob` adopts the server copy (or unions items) instead of clobbering.

That handles the **happy path** (two devices, one calendar job) but left two ways a
crew could still lose their own inventory:

1. **The manual-job start path bypassed the merge entirely.** `startManual` called
   `newDraft(job)` (empty items) + `saveDraft` unconditionally - it never fetched the
   server copy the way the calendar path (`onSelectEvent` -> `loadForJob`) did. So a
   second truck's crew who typed the same job name+date got a **blank** BOL for a
   `bol_id` that already had items. When they saved, the server replaced the first
   crew's inventory with the empty list. Silent data loss.

2. **The server upsert replaced `items_json` wholesale** (per ADR 0018 §Decision.3,
   so that item deletions propagate). That is correct *only* while the client always
   sends the full unioned list. Any stale or blank device that POSTed an empty list
   for an existing `bol_id` would wipe it, with nothing at the server to stop it.

Both are the same failure: **one BOL per job is right, but the crew needed to be
stopped from overwriting the one document, not silently merged into it.**

## Decision

**Make continuing an existing BOL explicit, and make blanking one impossible.**

1. **`loadForJobWithInfo(job)`** (`bolStore.ts`) does everything `loadForJob` did and
   also reports whether a BOL **already existed** for the job (a server row, or a
   local draft that already holds items / a signature), plus the item count and signed
   flag. `loadForJob` is now a thin wrapper that returns just the draft.

2. **Both start paths confirm before opening an existing BOL.** `onSelectEvent`
   (calendar) and `startManual` (manual entry) route through `loadForJobWithInfo`. If a
   BOL already existed, the crew see a confirm screen - *"This job already has a Bill of
   Lading (N items[, signed]). One BOL per job; put both trucks' items on this same one.
   Open it and keep adding so you don't overwrite what's already there."* - with
   **Open existing BOL** / **Cancel**. Cancel is non-destructive. The manual path no
   longer blanks; it continues the existing document like the calendar path always did.

   The "Open BOLs" chooser and the Report-tab deep link keep opening directly (no
   prompt): the crew explicitly picked *that* BOL, so there is nothing to warn about.

3. **Server blank-over-full guard** (`bol.py`, POST `/api/bol`). On an existing row,
   an incoming **empty** item list against a **non-empty** stored inventory is refused
   with **409**. 409 is a permanent rejection (`isPermanentRejection`), so the offline
   queue surfaces it to the crew as a failed op to retry/discard - it does not silently
   drop their work or retry a doomed write. A field-omitted / photo-backfill re-POST
   still carries the full list, so it is unaffected; only an explicit empty-over-full
   save is blocked.

## Consequences

- The two-truck case is safe on every entry path: the second crew is told they are
  adding to the existing BOL, and even a stale device cannot blank it server-side.
- **Deleting the last item of a BOL is blocked by the 409** (empty-over-full). This is
  an accepted trade: clearing an entire declared inventory is essentially never a real
  BOL flow, and the alternative (allow it) is the exact hole this closes. Editing down
  to one item, or replacing items, is unaffected - only a drop to zero on a non-empty
  row is refused.
- ADR 0018 §Decision.3 still holds ("upsert replaces `items_json` wholesale"), now
  with the single exception that a wholesale replace to **empty** on a non-empty row is
  rejected rather than applied.

## What would break if you undid this

- Reverting `startManual` to `newDraft` + `saveDraft` re-opens the silent
  data-loss path: a second truck's crew blanks the first's inventory on save.
- Removing the 409 guard removes the last line of defense for any stale/offline device
  that submits an empty list against a populated BOL.
- Dropping the confirm gate makes "continuing" indistinguishable from "starting new"
  to the crew - the whole point is that they are told, not silently merged.
