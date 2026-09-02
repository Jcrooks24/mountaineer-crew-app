---
description: Debug a defect in the crew app under the mandatory debugging protocol
---

Debug the following, under the protocol in `docs/DEBUGGING_PROTOCOL.md`:

**$ARGUMENTS**

If no target is given, ask what the symptom is, who saw it, when, and on which
environment and device before doing anything else.

**Read `docs/DEBUGGING_PROTOCOL.md` first and follow it in order.** It is mandatory
for debugging work on this project. Do not skip to a fix. In particular:

- **Rule zero:** confirm `git branch --show-current` is `staging`; never debug or fix
  on `main`. Never write to an unsuffixed (production) Sheet tab while reproducing.
  Evidence over memory, cite file:line / command / response. Do not drive the user's
  Chrome, ask them to look and report back instead.
- **STEP 1-2:** record the report verbatim, then pin the environment, the deployed
  commit, and the device's actual build. Most false starts here are debugging the
  wrong copy of the app.
- **STEP 3:** reproduce (staging UI, then the API directly, then a failing test), or
  say plainly that you could not and list what you tried.
- **STEP 4:** triage blast radius. Data being lost right now is an emergency, tell
  the user immediately. Check Known defects in `docs/RUNBOOKS.md` and
  `docs/decisions/` before assuming it is a bug.
- **STEP 5 (the one that matters):** write `Hypothesis / Falsifier / Result` and
  **take the falsifying observation before writing any fix.** A backfill stall on
  this app was fixed wrongly three times for want of this.
- **STEP 6-7:** localize along device -> queue -> API -> DB -> Sheet using
  `docs/DATA_FLOW.md` and `docs/DATA_FLOW_STAGING.md`, the system-check endpoints,
  the tagged backend logs, and the `crew_*_queue_v1` localStorage keys. Accept a
  cause only when it explains the whole symptom, why it hits this case and not
  others, and why it started now.
- **STEP 8-9:** smallest fix at the right layer, invariants preserved (offline-first,
  Sheet sync, auth, `job_uuid` identity, never delete queued work, idempotent
  retries). Then prove it: re-take the measurement, kill the reproduction, clean
  `npm run build`, single Alembic head, regression check. High blast radius gets a
  second pass asking a different question.
- **STEP 10:** close the loop in the same commit (DATA_FLOW_STAGING, RUNBOOKS /
  Known defects, ADR, CREDENTIALS).

**If more than one bug was handed over, use Batch mode** (its own section in the
protocol) and do not start fixing:

1. **Explore the whole list first, fixing nothing**, including the trivial items.
   Carry each through STEP 1-7 and record symptom, environment, reproduced,
   blast radius, cause (file:line, or hypothesis + falsifier + result), proposed
   fix, risk, and links to other items. Then report the batch-level findings:
   shared causes, ordering conflicts, items that are not bugs, items that cannot
   be verified from here, and a recommended order.
2. **Propose and stop.** Present the table (`# | Bug | Cause | Proposed fix |
   Blast radius | Risk | Notes`), one row per item including proposed skips, and
   **wait for per-item approval.** Silence is not approval; approval of one row
   is not approval of the table; a note on a row means re-propose that row. The
   only exception is active data loss, which is reported immediately and stopped
   before the rest of the batch is explored.
3. **Fix one at a time in the approved order, and keep a checkbox progress list
   posted in the session, re-posted as each item changes state:** `[ ]` not
   started, `[~]` in progress, `[x]` done with its proof named, `[!]` blocked
   with the reason, `[-]` skipped. Each item still gets its own STEP 8 and STEP
   9. Commit per item, not per batch. A mid-batch surprise (new bug, wrong
   cause, fix bigger than proposed) marks the item `[!]` and comes back to the
   user rather than being absorbed. Re-run the earlier reproductions at the end.

End with the protocol's report block (SYMPTOM / ENVIRONMENT / REPRODUCED / BLAST
RADIUS / HYPOTHESIS / FALSIFIER / RESULT / CAUSE / FIX / PROOF / UNVERIFIED / DOCS),
with honest blanks if the investigation is unfinished.
