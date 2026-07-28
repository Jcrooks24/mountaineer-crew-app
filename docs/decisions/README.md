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
| [0018](0018-bol-is-one-document-per-job.md) | A BOL is one document per job, keyed by job_uuid | Device-random bol_id made two rows per job that never merged. Do not go back to newUUID(). |
| [0019](0019-estimates-do-not-link-to-crew-jobs.md) | A crew-app estimate does not link to a crew-app job | PWA estimate -> SmartMoving -> booked job via Gcal; no reliable link. Do not re-add the link picker or est-vs-actual. |
| [0020](0020-bol-durability-and-honest-failures.md) | The BOL export is durable, and BOL endpoints fail honestly | 200-with-ok:false dropped signed BOLs; no reconciler; delete-before-write; staging shared prod's Drive folder. |
| [0021](0021-preserve-pending-bol-work-on-logout.md) | Pending BOL work is preserved across a logout / user switch | A signed BOL handed off mid-job (offline) was wiped. Preserve pending BOL ops + drafts, user-scoped. Do not revert to failed-only. |
| [0022](0022-signed-bol-is-retrievable-and-emailable.md) | A signed BOL is retrievable on demand and emailable | Driver couldn't produce the signed BOL (with addresses) at a border. On-device retrieval is offline; email is online-only on purpose. Don't offline-queue email; don't send a partial `shipment`. |
| [0023](0023-bol-is-self-contained-not-estimate-derived.md) | The BOL is self-contained and crew-entered | "Carried forward from the estimate" was boilerplate with no data behind it, and crew can't see the estimate on site. Capture the 375.505 required fields (incl. valuation) as required manual entry. Don't re-add estimate autofill. |
| [0024](0024-bol-guards-against-self-overwrite.md) | A BOL guards against being overwritten by a second crew/truck | `startManual` skipped the merge and the server replaced `items_json` wholesale, so a second truck could blank the first's inventory. Don't let a blank draft POST over an existing `bol_id`. |
| [0025](0025-enterprise-design-system-facelift.md) | Enterprise design system is the default look | The inline-style visual language is superseded; new and restyled screens follow `docs/DESIGN_SYSTEM.md`. Rolling out screen by screen. |
| [0026](0026-sheet-writes-retry-quota-and-cache-tab-metadata.md) | Sheet writes retry the quota, and tab metadata is cached | A 429 used to strand the row silently; every export also burned 3-5 metadata reads out of the 60/min budget. Retry per request (never per export), cache tab metadata 30s, and report current sync state, not any-error-ever. |
| [0027](0027-numeric-fields-separate-display-from-stored-value.md) | A numeric field's displayed text is not its stored value | Coercing onChange back into state made qty fields impossible to clear (`1` + typing `2` = `12`). Use `NumberField`; do not go back to `Number(e.target.value) || fallback`. |
| [0028](0028-closeout-reasons-are-multi-select-and-bidirectional.md) | Close-out reasons are multi-select and run in both directions | "Pick the biggest single reason" threw the rest away, and every option described a job running LONG so beating an estimate was unreportable. Old shapes upgrade on read; do not backfill, and do not collapse back to one cause. |
