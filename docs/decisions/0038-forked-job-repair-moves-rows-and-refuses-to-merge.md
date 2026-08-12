# 0038. Forked jobs are repaired by moving rows, and the script refuses to merge conflicts

**Status:** Active (2026-08-12).

## Context

A calendar job could end up with two identities. The canonical `job_uuid` comes
from the server, which mints a random `uuid4` and stores it in `calendar_jobs`.
When `GET /api/jobs/resolve` was unreachable the client fell back to
`calEventToJobUuid`, a deterministic FNV hash of the same calendar event id.
A random uuid and a hash can never agree, so any device that fell back used a
different identity for the same job.

`job_uuid` is what events, job setup, materials, BOLs, DVIRs, the job report, the
bill, photos, incidents and a dozen other things key on. A crew member on the
forked identity saw none of their colleagues' work on that job, and none of
theirs reached anyone else. Reported as "job set up data is not being carried
over that has been entered by another user, even after refresh".

The trigger was routine rather than exotic: the backend recycles its worker every
1000 requests by design (`--limit-max-requests`, see CLAUDE.md), and every
recycle is a window in which that call can fail.

The client side is already fixed: the resolve is retried, and on failure the id
already bound for that event is reused before any hash is minted. This ADR is
about the jobs that had already forked.

## Decision

### Detection is computed, never guessed

The fallback is a pure function of the calendar event id, so for every row in
`calendar_jobs` the orphan twin's uuid can be **computed exactly**.
`app/core/job_uuid_fallback.py` ports that function to Python and is verified
against the real frontend source, including the non-BMP case where JavaScript
iterates UTF-16 code units and Python would otherwise iterate code points.

No fuzzy matching on job names or dates. Nothing that could move one job's data
onto another job that merely looks similar.

**The consequence to watch:** if the port ever drifts from the frontend, this
finds zero forks - and finding zero looks exactly like success. That is why the
cross-language check exists and why both files say so at the top.

### Repair moves rows; it does not merge conflicts

Rows move from the twin onto the canonical uuid. Five tables constrain
`job_uuid` (`admin_entry_status`, `job_bills`, `job_reports`, `job_setup` unique,
`manual_jobs` primary key). Where **both** identities hold a row in one of those,
the script reports it and moves nothing for that table.

That case is two job reports for one job, written by two people who could not see
each other's. Choosing between them is a judgement about what happened on the
job, not about the data. A script cannot make it, and a script that picks
"newest" would quietly destroy the other person's account of the work.

Everything unambiguous still moves, so a conflict in one table does not block the
other nineteen.

### `calendar_jobs` is never rewritten

It is the canonical mapping - the definition of which uuid is correct. Rewriting
it would move the thing everything else is being repaired against.

### Dry run is the default

`--apply` is required to change anything. This edits production data across
twenty tables and is not reversible without a database restore.

### The Google Sheet is not touched

Rows already exported under the twin keep the old key. Re-drive the affected
records from Admin -> Sheet Backfill afterwards so the sheet carries the
canonical key; the orphan rows are then removed by hand.

Deliberate: deleting rows from the durable business record based on a computed
key match is a much heavier action than re-pointing a foreign key in Postgres,
and it belongs to a human looking at the sheet.

## Consequences

- Repair is per calendar job and re-runnable. Running it twice is a no-op,
  because after the first pass the twin has no rows.
- Conflicts need a person. The script names them and stops there.
- A device still holding the orphan uuid in its local storage will keep writing
  under it until it next resolves the job online, at which point the client fix
  re-points it. Repair therefore wants doing after the client fix is deployed,
  not before, or new orphan rows can appear behind the script.
- Manual jobs do not fork: both sides derive their uuid from the same
  `manualJobToJobUuid` hash. Only calendar jobs are affected, which is why the
  scan is driven from `calendar_jobs`.

## Alternatives considered

**Make the server's uuid deterministic (uuid5 of the event id) so the fallback
agrees.** Right for new jobs, and worth doing separately - but it does not
retroactively match the random uuid4s already issued, so a repair pass is needed
either way. It would also change the identity of every existing calendar job if
applied naively, which is a far larger migration than this.

**Auto-merge conflicts by newest-wins.** Rejected. It looks decisive and it
silently discards one crew member's record of a job.

**Leave the forks alone and let them age out.** Rejected: the data is not
transient. A forked job's report, bill and photos stay wrong and invisible
indefinitely, and the Sheet keeps both halves under different keys.
