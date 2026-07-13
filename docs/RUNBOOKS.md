# Runbooks

Checklists for when something is broken. Each one is written to be followed
literally, by someone who did not build this system, under time pressure.

**Before anything else, know this:** crew phones keep working offline. If the
backend is down, crews can still clock in, log materials, and capture BOLs. Their
work queues on the device and syncs when you fix things. **You almost never need
to panic-fix during a workday, and you should never tell crews to stop working.**
The two exceptions that do lose data are noted where they apply.

---

## Triage: what is actually broken?

Run this first. It takes two minutes and tells you which runbook to open.

1. Open the backend health root: `https://<backend-host>/` . Expect
   `{"ok": true, "service": "mountaineer-crew-app-backend"}`.
   - No response or 502 → [Backend is down](#backend-is-down).
2. Log into the app as an admin. Go to **Admin → Advanced Settings → System Check**.
   That panel checks the database, the Sheets API, the Drive API, and required
   environment variables.
   - Database check fails → [Database is down](#database-is-down).
   - Sheets or Drive check fails → [Google access is broken](#google-access-is-broken).
   - An env var is flagged → [docs/CREDENTIALS.md](CREDENTIALS.md).
3. If the API is healthy but the app looks wrong or blank → [A deploy broke something](#a-deploy-broke-something).
4. If it is one person, not everyone → [Someone is locked out](#someone-is-locked-out).

---

## Backend is down

Symptoms: app shows sync errors, the health root does not respond, Render shows
the service as failed or restarting in a loop.

1. **Open Render → the affected service → Logs.** Read the last 100 lines. Do not
   restart before reading them; a restart erases the evidence of why it died.
2. **Look for `Out of memory` or an exit code 137.** This is the failure mode this
   service has had repeatedly. The instance is 512 MB.
   - Confirm the **start command** is exactly what is documented in
     [CLAUDE.md](../CLAUDE.md). It runs migrations in a separate process and caps
     requests and concurrency. If someone "simplified" it, that is your bug. Restore
     it and redeploy. Background: [ADR 0002](decisions/0002-render-start-command.md).
   - If the start command is intact and it still OOMs, look for a new endpoint
     that loads a large result set or a big upload. The 100 MB body limit is in
     `backend/app/core/limits.py`.
3. **Look for `ProgrammingError` naming a missing column.** That means migrations
   did not run. Migrations are deliberately not run at app startup. Check that the
   start command's `python scripts/run_migrations.py` half actually ran and
   succeeded, above the uvicorn lines in the log.
4. **Look for a `RuntimeError` about `JWT_SECRET` at import.** The app refuses to
   boot when `DATABASE_URL` is set and `JWT_SECRET` is not. Set it. This is
   intentional, not a bug.
5. If the logs show nothing and it simply will not start, **roll back**: see
   [A deploy broke something](#a-deploy-broke-something).

Crew impact while you work: none, as long as they do not log out. Their queues hold.

---

## Database is down

Symptoms: System Check database row fails; logs show connection refused, SSL
errors, or "too many connections".

1. **Render → the Postgres instance → check status and metrics.** Confirm it is the
   right database for the environment you are looking at. Prod and staging have
   separate databases and it is easy to be looking at the wrong one.
2. **If it is out of connections:** the backend recycles workers via
   `--limit-max-requests`, so leaked connections are usually bounded. A restart of
   the backend service clears them. If it recurs, look for a code path that opens a
   session without closing it, rather than raising the connection cap.
3. **If it is out of disk or suspended:** this is a Render dashboard problem, not a
   code problem. Resize or resume.
4. **If the instance is gone entirely:** restore from Render's backup, then verify
   with the System Check panel. After a restore, the Sheet may be **ahead** of the
   database (rows exported before the snapshot you restored to). The auto-reconciler
   only pushes database → Sheet, never the reverse, so it will not fix that. You
   will have to reconcile by hand against the Sheet, which is why the Sheet is
   valuable as an independent copy.

Crew impact: none while it is down. But **queued work will fail to sync and retry
forever**, which is fine, except that the outbox prunes anything older than **14
days**. Do not leave the database broken for two weeks.

---

## A deploy broke something

Symptoms: it worked an hour ago, it does not now, and there is a recent push.

1. **Identify the bad commit.** `git log --oneline -10` on the affected branch.
   Check Render and Vercel for which deploy is live.
2. **Roll back the host, not the code, first.** It is faster and reversible.
   - **Vercel:** Deployments → find the last known-good build → Promote to
     Production. This is instant.
   - **Render:** the service's Deploys tab → find the last successful deploy →
     Redeploy / Rollback.
3. **Then fix forward on `staging`.** Never patch `main` directly. Reproduce on
   staging, fix, run `/vet`, then promote.
4. **If the deploy included a database migration, rolling back the code is not
   enough.** The migration already ran. Check whether the old code can tolerate the
   new schema (usually yes for an added column, no for a renamed or dropped one).
   If not, you need a down-migration, and you should treat this as a real incident:
   take a database backup before doing anything else.
5. **If the frontend deployed but crews still see the old version:** that is by
   design. The service worker uses `prompt`, so a new build waits until the crew
   taps the update banner. It is not stuck. See
   [ADR 0006](decisions/0006-service-worker-prompt.md).

---

## Someone is locked out

Symptoms: one crew member cannot log in, or their password reset link says
"invalid or expired".

This has a specific and repeated cause, so check it in this order:

1. **Did this start right after a promotion to `main`?** If so, suspect
   `FRONTEND_URL` on the **prod** Render service before anything else. If it still
   points at the staging frontend, the reset email sends crew to staging, where the
   token does not exist, and they get "invalid or expired".
   - **Grep the Render logs for `[forgot-password]`.** That line prints the
     generated reset link. A wrong hostname is instantly visible.
2. **Did they change their password on staging during testing?** The user-migration
   script is `ON CONFLICT DO NOTHING`, so prod keeps the **prod** password hash. A
   staging password change does not carry over. They sign in with their old prod
   password, or reset. See [ADR 0004](decisions/0004-user-migration-conflict-policy.md).
3. **Are reset emails being sent at all?** Check `POSTMARK_SERVER_TOKEN` and
   `SMTP_FROM` on the affected environment. With the token unset, the mailer prints
   to stdout and sends nothing, silently. Admin has a `test-email` endpoint.
4. **Do they exist in this environment's database at all?** Prod and staging have
   separate user tables. A crew member who only ever existed on staging is not on
   prod until the migration script runs.
5. **Last resort:** an admin can create the user directly (`POST /api/users`, which
   is admin-gated). If you have lost admin access entirely, set `ADMIN_EMAIL` on
   Render to your address and restart. It auto-promotes that user to admin on every
   startup. That is the way back in.

---

## Data is not reaching the Google Sheet

Symptoms: the office says a job is missing. The crew swear they logged it.

1. **Wait five minutes.** Sheet export is asynchronous and eventually consistent.
   The auto-reconciler runs every 300 seconds and backfills anything that failed.
   A brief gap is normal.
2. **Is the data in the app?** Look at the job in the admin view. This tells you
   which half of the pipeline is broken.
   - **Not in the app either** → the crew's device never synced. It is not a Sheets
     problem. Their phone still holds it. Have them open the app **with signal** and
     leave it open; the queues drain on reconnect. Do not have them log out, and do
     not have them reinstall: [logging out deletes unsynced photos and reimbursements](#known-defects).
   - **In the app, not in the Sheet** → continue below.
3. **Check Admin → Advanced Settings → System Check → Sheet Syncs.** It lists every
   `SHEETS_*_TAB` variable and flags the unset ones.
4. **Look in the other tab.** If a tab variable is unset on **staging**, staging
   writes into the **production** tab. Your "missing" row may be sitting in the
   office's real sheet, mixed in with real data, put there by a test. Search the prod
   tab for the job. Delete the test rows and set the variable. See
   [ADR 0003](decisions/0003-staging-prod-sheet-tab-split.md).
5. **Check the Sheets API in System Check.** If it is failing, go to
   [Google access is broken](#google-access-is-broken). Once access returns, the
   reconciler backfills events automatically. Note that the reconciler covers
   **events**; other record types rely on the export firing at write time, so for
   those you may need to re-save the record to retrigger the export.

---

## Google access is broken

Symptoms: Sheets and Drive both fail in System Check. Calendar shows no jobs.
Nothing was deployed.

The likely cause is the OAuth token, which lives in the **database**
(`system_config`, key `google_oauth_token`), not in an environment variable.

1. **Confirm it is not just one API.** If only Maps features are dead, it is the
   `GOOGLE_MAPS_API_KEY` or a disabled API in Cloud, not the OAuth token. If only
   the address typeahead is dead, the **Places API** is probably not enabled. See
   the API table in [docs/CREDENTIALS.md](CREDENTIALS.md#google-cloud-specifics).
2. **Check the Google Cloud project:** billing active, APIs enabled, key not
   restricted to the wrong referrer, quota not exhausted.
3. **Re-issue the OAuth token.** Run the local Google OAuth flow, then paste the
   token in via Admin (`/api/admin/cal-token`). **Do this per environment**, since
   each environment's database holds its own copy.
4. **Afterwards, verify with System Check** and confirm the reconciler catches up.

Data impact: none, if you fix it within the retention window. Postgres is the system
of record and the Sheet is a mirror. Events backfill automatically.

---

## Known defects

Live bugs that are known and not yet fixed. If you hit one of these, you have found
a real issue, not a misunderstanding. Keep this list honest: delete an entry when it
is fixed, and add one when a `/vet` pass finds something you cannot fix that day.

1. **Logging out destroys unsynced photos and reimbursements.** `clearCrewState()`
   deletes the entire IndexedDB database. A crew member who logs out with a pending
   receipt photo loses it permanently. **Never tell a crew member to log out or
   reinstall as a troubleshooting step** unless you have confirmed their queues are
   empty.

2. **Queued work is silently dropped after 14 days**, and any 4xx response (other
   than 401, 403, 408) drops the op with only a console warning. There is no
   dead-letter store and no user-visible signal. A backend validation change can
   therefore silently delete queued field work from crew devices. Tighten server
   validation carefully.

3. **Estimate totals may be stale on old estimates.** Item adds used to double-count
   the newly added item into the estimate's rolled-up weight and volume (fixed
   2026-07-13). Item counts were always correct; only the totals inflated, by exactly
   the last-added item's contribution. Editing or deleting any item recalculated
   correctly and healed the estimate, so only estimates whose items were **only ever
   added** are affected. Run `backend/scripts/recalc_estimate_totals.py --dry-run`
   per environment to see which, then without the flag to fix them.

### Recently fixed (kept briefly so you do not re-report them)

- Job photos not auto-retrying on reconnect. Fixed 2026-07-13: the `online` handler
  now drains them like every other queue.
- Estimator and job-inventory item queues not being idempotent. Fixed 2026-07-13:
  both now send a client-minted `item_uuid` and the endpoints upsert on it.
- `alembic revision --autogenerate` emitting spurious `DROP TABLE`. Fixed 2026-07-13:
  the seven missing model imports were added to `alembic/env.py`. Still worth reading
  any generated migration before applying it.
