# 0021. Pending Digital BOL work is preserved across a logout / user switch

**Status:** Active. Decided 2026-07-16. Extends [ADR 0013](0013-rejected-queue-work-is-never-deleted.md)
(never delete rejected work) and the failed-work preservation it drove.

## Context

`clearCrewState` wipes every `crew_`-prefixed store when a different user logs in
on a shared phone, so crew B never inherits crew A's queued work. To stop that
wipe from destroying A's un-synced work, `preserveFailedWork` snapshots A's
**failed** queue entries under a wipe-proof, user-scoped key and restores them
when A returns.

That covers only FAILED entries, on the stated assumption that "pending work
drains normally before the switch." For the Digital BOL that assumption is false.
Crew routinely hand a shared phone off - or log out - mid-job, offline, right
after signing. At that moment the submit/sign/pdf ops are PENDING (no `failed_at`
yet), the draft holding the signature PNGs is a plain `crew_bol_draft_v1:*` key,
and the wipe destroys both. The signatures have no other copy. This is the
strongest match for the reported lost-BOL incident.

The obvious alternatives are worse for the field:

- **Hard-block logout while a BOL op is pending.** A shared phone must be
  handed off on demand, including mid-job. Blocking strands the device.
- **Warn only.** A crew member with no signal or in a hurry dismisses it and
  loses the document anyway.

## Decision

**Preserve PENDING Digital BOL work (not just failed) across the wipe, scoped to
the departing user, and restore it when that same user logs back in on the
device. Do not block or warn.**

`backupFailedWork` (run before every wipe) now, for the BOL queue specifically,
snapshots ALL pending + failed ops - not just failed - plus every
`crew_bol_draft_v1:*` draft (the pdf op regenerates the signed PDF from the
draft, so a restored op with no draft would have nothing to build). Every other
queue keeps the failed-only rule. `restoreFailedWork` restores the BOL queue and
re-writes any preserved draft that is not already present.

## Consequences

- A signed BOL survives a mid-job hand-off: it waits under the departing user's
  scoped key and drains when they next log in on that device.
- **No cross-user mis-attribution.** The snapshot is keyed to the departing
  user's id and restored only to that same id, and the server sets `created_by`
  from the authenticated user at sync time. Crew B never receives or syncs A's
  BOL work. This is why the general "don't preserve pending" rule existed - and
  why the user-scoped stash is safe to relax it for BOLs.
- The BOL exception is deliberately narrow. Every other queue still preserves
  only failed work; a queue whose pending loss is merely an inconvenience does
  not warrant the extra retained state. A new BOL-like queue (signed, one-copy)
  should extend this, not copy the general rule.
- A departing user who never returns to the device leaves one stale stash in
  localStorage. Bounded (one per departed user) and acceptable.

## What would break if you undid this

Reverting to failed-only preservation restores the exact silent, one-copy loss:
a signed BOL queued but not yet synced, wiped the moment the phone changes hands
- which is precisely when crew hand phones off. Preserving pending work for
every queue instead (the other over-correction) would risk syncing an unrelated
user's ordinary queued work under the wrong identity; the fix is scoped to BOLs
on purpose.
