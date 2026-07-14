# Decision log

Why things are the way they are.

The rest of the documentation tells you **what exists**. This tells you **whether
it is safe to change**. Without it, a successor either breaks things by "fixing"
decisions that were deliberate, or freezes and touches nothing.

## What earns an entry

One test: **would a competent person, seeing this for the first time, be tempted to
undo it?** If yes, write it down. If no, do not.

That means these get entries:

- Anything that looks wrong, redundant, or over-complicated but is load-bearing.
- Anything we tried the obvious way first and got burned.
- Anything where the safe-looking refactor causes silent data loss.

And these do not:

- Routine library or framework choices nobody would question.
- Anything already obvious from the code.
- Feature descriptions. That is what the code and the commit are for.

## How to add one

Copy the shape of an existing entry. Number it sequentially. Keep it to one page.
The **Consequences** and **What would break if you undid this** sections are the
whole point; do not skip them to save time.

Add the entry in the **same commit as the change it explains**. A decision log
written retroactively is a decision log that is already wrong.

## Index

| # | Decision | Short version |
|---|---|---|
| [0001](0001-staging-first-branching.md) | Staging-first branching | Everything ships to `staging`. `main` is on crew phones. |
| [0002](0002-render-start-command.md) | The Render start command | Migrations run in a separate process; uvicorn's limit flags are not decoration. |
| [0003](0003-staging-prod-sheet-tab-split.md) | One Sheet, split by tab | Both environments write to the same spreadsheet, kept apart by tab name via env vars. |
| [0004](0004-user-migration-conflict-policy.md) | User migration is `ON CONFLICT DO NOTHING` | Prod wins. A password changed on staging does not carry over. |
| [0005](0005-client-derived-job-uuid.md) | `job_uuid` is derived on the client | A hash, so offline work correlates to a job without a server round trip. |
| [0006](0006-service-worker-prompt.md) | Service worker prompts, never auto-updates | Auto-reload would interrupt data entry mid-sync. |
| [0007](0007-client-uuid-idempotency.md) | Client-generated UUIDs on every write | The single invariant that makes offline retry safe. |
| [0008](0008-async-eventually-consistent-sheets.md) | Sheets export is async and eventually consistent | The request never waits on Google. A reconciler backfills. |
| [0009](0009-offline-auth-cache.md) | The user is cached and only cleared on an explicit 401 | Otherwise losing signal logs the whole crew out. |
| [0010](0010-wrap-up-anchor.md) | The wrap-up estimate stores an anchor, not a timestamp | Makes the projection live-editable and always creatable. |
| [0011](0011-no-em-dashes.md) | No em dashes | A house style rule, enforced everywhere. |
| [0012](0012-docs-mirror-oauth-not-service-account.md) | The docs mirror uses a user token | A service account has no Drive quota. Do not "fix" this into one. |
| [0013](0013-rejected-queue-work-is-never-deleted.md) | A queue never deletes work the server rejected | It marks it failed and shows the crew member. **Five queues still need this.** |
| [0014](0014-skill-rating-is-designated-not-inherited.md) | Skill rating is designated, never inherited | The `crew_lead` role does not grant it. Only `admin` + the per-person `is_skill_rater` flag do. |
| [0015](0015-inventory-logging-is-paused-on-local-jobs.md) | Inventory logging is paused on local jobs | Hidden, not deleted. Too slow to use in the field; LD keeps it. Do not remove the code. |
| [0016](0016-logged-items-are-snapshots-not-catalogue-references.md) | A logged item is a snapshot, not a catalogue reference | No FK to the catalogue, on purpose. **Do not normalize this**, it would rewrite history. |
| [0017](0017-offline-queues-store-bytes-not-file-handles.md) | An offline queue stores bytes, never a File handle | A stale File uploads an empty body and 422s on a field the client provably sent. |
