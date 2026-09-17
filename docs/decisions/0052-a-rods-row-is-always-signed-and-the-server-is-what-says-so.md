# 0052 - A RODS row is always signed, and the server is what says so

Date: 2026-09-17
Status: Accepted

**Driving scenario:** From the 2026-09 DOT gap audit, item B-14, and the owner's
answer at intake on 2026-09-17 that settled why it matters: **the app's RODS is
the record of duty status, always, with no paper log kept alongside it.** That
makes every row in `rods_logs` a certified federal record rather than a
convenience view of one, and it means an uncertified row published into the
office's compliance copy is not a cosmetic problem.

**User classes affected:** the **mover and driver** who signs the day, whose
certification is what the row represents, and who would be the person an
uncertified log was attributed to. The **office administrator**, who reads the
RODS worksheet as the compliance copy and has no way to tell a certified row from
an uncertified one by looking. The **systems owner**, who now gets a server rule
instead of a client habit to rely on.

**Assumption this rests on:** That no legitimate caller ever needs to store an
unsigned day in `rods_logs`. If in-progress days must be server-side for
continuity, which is the open A-03 finding, they go in their own table. If that
assumption is ever wrong, this ADR is what to reopen, rather than quietly
relaxing the guard.

## Context

`rods_logs.signature` is nullable, and the model comment says why: "an
in-progress day is autosaved to the server unsigned (for continuity /
cross-device resume)". That autosave was designed and never built. The field app
has exactly one submit call site, in the sign-off component, reached only after
the driver signs.

So the rule "a RODS row is a signed day" held **only because the client happened
to behave**. Nothing on the server said it.

That mattered more than it looked, because four server paths read the table and
the signature check was in none of them:

- `job_checklist.py` ticks the close-out RODS item when any row exists
- `long_distance.py` lists days back to the driver
- `sheet_backfill.py::_src_rods` builds "what the Sheet should contain"
- `sheet_backfill.py::_re_rods` re-exports a row to the worksheet

and `export_rods_to_sheets` itself had no check either. The only gate was an
`if existing.signature:` in the router, on the submit path.

The consequence of a single unsigned row reaching the table: the backfill's
health check would report it as missing from the Sheet, forever, because nothing
would ever publish it. Somebody would then press the re-export that exists to fix
exactly that, and an uncertified duty log would land in the compliance copy
looking identical to a signed one. The close-out checklist would tick for it too.

The audit originally reported this as a live defect. Reading the call sites
showed it was latent, which is worse in one specific way: it is a trap that
springs on whoever implements the draft store next, because re-opening this
endpoint to unsigned payloads is the obvious way to build it.

## Decision

**An unsigned day is refused, at three layers.**

1. **The router refuses it.** `POST /api/long-distance/rods` returns **400** with
   a sentence a driver can act on when `signature` is blank. 400 is deliberate:
   `queueFailure.ts` classifies every 4xx as permanent except 401, 403, 408 and
   429, so the day is marked failed, left in the queue per ADR 0013, skipped so
   it cannot wedge the line, and shown to the crew member. A transient code would
   retry forever on a payload that can never fix itself.

2. **The export refuses to publish it.** `export_rods_to_sheets` returns 0 for a
   row with no signature, so no caller can put an uncertified log into the
   worksheet whatever it was handed.

3. **The backfill does not consider it publishable.** `_src_rods` filters to
   signed rows, so an unsigned row predating this rule is neither reported as a
   gap nor offered for re-export.

The schema field stays `str | None` rather than becoming required, so the refusal
is our own 400 with readable text instead of a 422 schema dump.

Since a submit is now always signed, the conditional signature assignment and the
two `if row.signature:` export gates in the router are gone. They were guarding
against a case that can no longer arrive.

Guarded by `backend/scripts/verify_rods_signed_only.py`, which exercises all
three layers with fakes and needs no database.

## Consequences

- `rods_logs` is now, by rule, a table of certified records. Part 1 of
  `COMPLIANCE_REFERENCE.md` can state that as an invariant instead of a habit.
- The close-out checklist's RODS tick is correct by construction rather than by
  luck, which closes the weaker half of that finding.
- Re-signing a corrected day still works and still replaces the earlier
  certification. Reopening a day was always intended.
- Any pre-existing unsigned row stays in the table and is simply never published.
  Nothing is deleted, and nothing is migrated, because a row we are unsure about
  is evidence, not garbage.
- The in-progress draft store (A-03) is now blocked from taking the cheap route,
  which is the point.

## What would break if you undid this

**If you re-open the endpoint to unsigned payloads to build draft autosave:** the
backfill starts listing every in-progress day as missing from the Sheet, the
health check fills with gaps that can never close, and the re-export button
publishes uncertified duty logs into the office's compliance copy where nothing
distinguishes them from signed ones. Under V-5 there is no paper log to check
them against. Build the draft store as its own table instead.

**If you delete layers 2 and 3 as redundant:** they are not. Layer 1 protects the
submit path only. Layers 2 and 3 are what stop a row that predates this rule, or
arrives some future way, from reaching the worksheet. The failure they prevent is
silent and lands in a legal record.

**If you change the 400 to a 422 or a 409:** 422 loses the readable message, and
any move into 401, 403, 408 or 429 makes the offline queue retry a payload that
can never succeed, which wedges a driver's queue and burns their data on every
reconnect. That exact class of bug is documented in `queueFailure.ts`.
