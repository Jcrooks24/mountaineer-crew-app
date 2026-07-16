# 0007. Every offline write carries a client-generated UUID

**Status:** Active. This is the load-bearing invariant of the whole offline design.

## Context

A crew member taps "clock in" at a jobsite with one bar of signal. The request goes
out. The tunnel swallows the response. The device has no idea whether the server
committed it.

If the device retries, it might double-write. If it does not retry, it might lose
the event. Both are unacceptable: one corrupts payroll, the other loses a day's
hours.

## Decision

**The client generates a UUID and puts it in the payload before the write is ever
queued.** `crypto.randomUUID()`, with a `Date.now() + Math.random()` fallback for
older devices. The backend **upserts** on that key.

Retrying is therefore always safe. If the first attempt committed, the retry is a
no-op. If it did not, the retry writes it. The device never has to know which
happened, which is the entire point, because it cannot know.

This holds for events (`event_id`), materials (`submissionId`), BOLs (`bol_id`),
RODS (driver plus date), long-distance days (`day_id`), incidents
(`incident_uuid`), off-job hours (`entry_uuid`), office hours (`entry_uuid`), and
reimbursements (`reimbursement_uuid`).

It is also what makes it safe that the re-entrancy guards are per-module and not
cross-tab: two open tabs draining the same queue at once cannot double-write.

## Consequences

- **Any new offline-capable write must carry a client UUID and the endpoint must
  upsert on it.** This is not optional and it is the first thing to check in review.
- The `/api/sync` endpoint goes further: it returns a `failed[]` array where each
  entry carries a `retryable` boolean. Only retryable events stay queued. **Do not
  "simplify" that into a boolean ok/fail response.** Dropping a retryable event
  silently loses a logged clock-in.

## Formerly violated, now fixed (2026-07-13)

`estimatorQueue` and `jobInventoryQueue` were the only two queues without a key, and
they were genuinely not idempotent: the backend did a plain insert against an
autoincrement primary key, so a lost response produced a duplicate line item on the
next drain.

Both now send `item_uuid` (the queue-op id, already a persisted `crypto.randomUUID()`),
and both endpoints upsert on it behind a unique index.

Two things that fix taught us, worth keeping:

1. **The immediate-POST path had to send the key too, not just the drain.** These two
   queues fire an optimistic POST *and* keep the op queued. Adding the uuid only to
   the drain would have left the original bug fully intact: the first POST inserts
   with no key, its response is lost, and the drain's keyed retry finds nothing to
   match and inserts again. If you add a queue with an optimistic-write path, the key
   goes on **every** path that can reach the endpoint.
2. **A nullable unique column is the right shape for a retrofit.** Rows written before
   the key existed have `NULL`, and Postgres permits many NULLs under a unique
   constraint, so old rows coexist and an older app build that sends no uuid keeps
   working.

## What would break if you undid this

Server-assigned ids, or a non-upserting endpoint, reintroduce double-writes and lost
writes on exactly the flaky-signal conditions this app exists to survive. The bugs
would appear as inexplicable duplicate rows in payroll, weeks later, with no way to
reconstruct what happened.
