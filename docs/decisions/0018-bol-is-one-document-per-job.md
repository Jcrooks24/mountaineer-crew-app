# 0018. A BOL is one document per job, keyed by job_uuid

**Status:** Active. Fixed 2026-07-15 after a field report that BOL inventory did not
sync across devices.

## Context

A Bill of Lading is a signed legal document. Two crew at the truck open the BOL for
the same job and expect to be building one shared inventory. They were not.

Two root causes, compounding:

1. **The `bol_id` was device-random** (`newUUID()` in `newDraft`). It is the upsert
   key the server keys on. So two devices opening the same job's BOL minted two
   different `bol_id`s and created **two separate server rows for one job that never
   merged**. Whichever device you looked at, you saw only its own items. This
   violated the app's own rule (ADR 0005 / Behavior 5: identify by the shared
   `job_uuid`, never by a per-device id).

2. **Adoption let local always win.** `loadForJob` adopted the server copy only when
   `String(server.updated_at) >= String(local.updated_at)`. Every local edit bumped
   `local.updated_at`, so once a device touched its own draft it out-timestamped the
   server and never adopted it again. The string compare was also wrong at sub-second
   granularity (Python `+00:00` vs JS `Z` suffix sort differently). So even the
   single-row case would not converge.

3. **Items only reached the server on a completeness-gated Save.** While the crew
   were building the list — the exact window they care about — the server had
   nothing, so a second device saw nothing.

## Decision

**One BOL per job, identified deterministically; server-authoritative adoption;
items stream to the server as they are added.**

1. **`bol_id = bolIdForJob(job_uuid)`** — an FNV hash of `job_uuid`, so every device
   computes the same id and upserts the same row. A truly job-less BOL falls back to
   random (nothing to converge on).

2. **`loadForJob` adopts the server copy whenever there are no un-synced local ops.**
   A fully-synced local draft has nothing to protect, so the server is the authority,
   full stop — the `updated_at` race is gone. When un-synced local edits exist, the
   two drafts are the *same document* (same id), so their item lists are **unioned by
   item id** (local wins a per-item conflict) rather than one clobbering the other.

3. **`autosyncDraft` pushes items to the server on every edit, debounced ~1s**, with
   no completeness gate. Signing stays an explicit, gated step; only the item list
   streams. The server upsert replaces `items_json` wholesale and the sheet export is
   replace-style (delete-by-`bol_id`, rewrite), so a removed or edited item is
   reflected on the server and in the sheet, not just added.

## Consequences

- **Existing BOLs are not orphaned.** They carry old random ids, but `fetchRemoteBol`
  finds them by `job_uuid` and adoption keeps the server's id. A device opening such a
  job adopts the existing row and keeps upserting it. Only *new* BOLs get the
  deterministic id. Nothing already signed is lost.
- **Concurrent editing of the same BOL on two devices is not fully solved**, and this
  is deliberate. The union merge preserves additions from both sides but **cannot
  express a deletion**: an item deleted on device A while device B still holds it will
  reappear on the next merge. A real delete is honored only once there are no
  competing un-synced edits and the server copy is adopted wholesale. This is the
  safe-for-data direction (keep, don't silently lose), and simultaneous two-device
  editing of one BOL is rare. If it becomes common, the next step is per-item
  tombstones, not a smarter timestamp.
- Signatures are never autosynced; they go through the explicit sign op, which the
  merge leaves with whichever side has a pending sign.

## What would break if you undid this

Going back to `newUUID()` for `bol_id` immediately recreates the two-rows-per-job
split and the "does not sync" report. Reinstating the `updated_at >= updated_at`
adoption guard re-freezes a device on its own draft the moment it makes an edit. Both
look reasonable in isolation and both were the bug.
