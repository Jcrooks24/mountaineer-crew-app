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
   `SHEETS_*_TAB` variable and flags the unset ones. Read the columns literally:
   - **Exists = `not yet`** is normal. Nothing has ever synced to that tab, and
     `_ensure_tab` creates it on the first write. `Long-distance pay` reads this
     way until someone logs a long-distance day.
   - **Exists = `missing`** is a real problem: this sync has written before, so the
     tab was renamed or deleted in the sheet, or the `SHEETS_*_TAB` variable was
     changed to a name that does not exist.
   - **Last sync = red `error …`** means the *most recent* attempt failed. A grey
     timestamp with "recovered from an error …" underneath means it failed once and
     has synced fine since; that is not something to chase. See
     [ADR 0025](decisions/0025-sheet-writes-retry-quota-and-cache-tab-metadata.md).
   - A `429 RATE_LIMIT_EXCEEDED` or an SSL `EOF occurred` in the error text is a
     transient Google failure. Those are retried with backoff now, so a *current*
     one means the retries were exhausted (a sustained burst, not a blip) - re-save
     the record to re-drive the export, and grep the Render logs for
     `[sheets] transient` to see how often it is happening.
4. **Look in the other tab.** If a tab variable is unset on **staging**, staging
   writes into the **production** tab. Your "missing" row may be sitting in the
   office's real sheet, mixed in with real data, put there by a test. Search the prod
   tab for the job. Delete the test rows and set the variable. See
   [ADR 0003](decisions/0003-staging-prod-sheet-tab-split.md).
5. **Check the Sheets API in System Check.** If it is failing, go to
   [Google access is broken](#google-access-is-broken). Once access returns, the
   auto-reconciler backfills everything on its own: events and BOLs every 5
   minutes, and all other syncs (materials, reports, RODS, reimbursements, ...)
   every ~20 minutes via the backfill diff (ADR 0031). A record missing from the
   sheet lands within one cycle without a re-save. App Health WARNs while the
   Sheet is out of sync. To clear a large backlog faster, use Admin, Advanced
   Settings, Sync & Accuracy, Sheet Backfill to re-send on demand (100 per sync
   per click). If a sync's records will not re-send at all, that row shows the
   export's `last_error` - fix that record's data rather than re-sending again.

---

## The Google Sheet has junk (duplicates, blank rows, overwritten headers)

The 2026-08-05 audit class: a header cell gets overwritten, the sync silently
mis-handles it, and duplicates or blank rows pile up unnoticed. Three layers now
cover this - detect, fix, prevent.

**Detect.** `backend/scripts/sheet_integrity_check.py` runs nightly (Render Cron
Job; emails jacob@ on any FAIL - see CREDENTIALS) and can be run by hand any time:

    DATABASE_URL=<prod> GOOGLE_SHEETS_SPREADSHEET_ID=<id> \
      POSTMARK_SERVER_TOKEN=<tok> SMTP_FROM=<from> \
      python backend/scripts/sheet_integrity_check.py

- **FAIL - KEY column missing from a header** = row 1 was overwritten (the `dfg`
  cascade). That tab's export is ALSO failing closed now (`SheetHeaderError`) and
  showing RED in Sheet Syncs. Fix the header text in the sheet; exports resume. If
  duplicates already accumulated, dedupe below (or `repair_reimbursements_sheet.py`
  for the specific Reimbursements cascade).
- **FAIL - duplicate `<key>`** = the replace-style delete stopped matching. Run
  the cleanup tool's `dedupe` step.
- **FAIL - junk tab** = an env-var-named tab exists. `cleanup_sheet.py --step tabs`.
- **FAIL - completeness: N server record(s) MISSING from the sheet** = a sync is
  stuck; those Postgres records never reached the Sheet (the message names the tab
  and, if the sync is failing, the `last_error`). Re-drive them: Admin -> Advanced
  Settings -> Sync & Accuracy -> Sheet Backfill (or `POST
  /api/admin/system-check/sheet-backfill`). If they will not drain, fix the record
  data behind `last_error`. This is the check that matters most before a DB is
  retired/migrated - the Sheet is the long-term copy.
- **WARN - missing columns** = usually staging columns not yet promoted to prod;
  harmless, clears when the next promotion adds them.
- **WARN - blank residue rows** = `cleanup_sheet.py --step blankrows` (after a
  Sync & Accuracy run).

**Fix.** `backend/scripts/cleanup_sheet.py` - dry-run first, per-step `--apply`:
`tabs`, `blankrows`, `dedupe` (JobReports auto; **Events is report-only** - a naive
"latest logged_at" rule would keep the device time and delete the admin's manual
correction, so resolve those 3 by hand), `officehours`, `protect`.

**Prevent (already in code, staging - carry to main at next promotion).**
`_ensure_tab` fails closed on a corrupted header and auto-protects row 1 of every
new tab (warning-only); `_delete_sheet_rows_by_value` raises instead of silently
no-opping when its dedupe key column is gone. Existing tabs were row-1 protected
by hand on 2026-08-05.

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

## The docs mirror stopped updating

Symptoms: the "Sync docs to Drive" workflow is red in the GitHub Actions tab, or the
Google Docs in the Drive folder are stale relative to the repo.

**Nothing in the app is broken.** This workflow only copies documentation into Drive.
Crew are unaffected, no data is at risk, and you can ignore it until convenient.

1. **Open the failed run** in the Actions tab and read the error.
2. **`invalid_grant` or a refresh failure** means the Google OAuth token was rotated or
   revoked, and the `GOOGLE_OAUTH_TOKEN_JSON` repository secret still holds the old
   one. Copy the current authorized-user JSON (the same value in `system_config`, key
   `google_oauth_token`) into **Settings > Secrets and variables > Actions**.
3. **`storageQuotaExceeded`** means someone swapped the user token for a service-account
   key. Service accounts have no Drive storage. Put the user token back and read
   [ADR 0012](decisions/0012-docs-mirror-oauth-not-service-account.md).
4. **A 404 on the folder** means someone pointed the script at a folder created by hand
   in the Drive UI. The `drive.file` scope cannot see those. Let the script create its
   own folder.
5. **Re-run it** from the Actions tab ("Run workflow"), which also works for seeding the
   folder the first time without pushing a doc change.

Data impact: none. The repo is the source of truth; the Drive copy is disposable and is
rebuilt on the next successful run.

---

## The nightly crew email did not arrive

Symptoms: no "Crew feedback" / "Incidents" email around 9 PM Mountain, or it arrived
with something missing.

**Nothing in the app is broken and no data is at risk.** The email is a **Google Apps
Script bound to the Sheet**, not backend code, so nothing in Render logs will mention
it. Source of truth is `apps_script/nightly_crew_email.gs`, but what actually runs is
whatever is pasted into the Sheet's script editor (Extensions > Apps Script).

1. **Run `dryRunNightlyCrewEmail()`** from the Apps Script editor and read View > Logs.
   It prints the exact email it would send, sends nothing, and writes nothing. This
   answers "is it broken, or was there genuinely nothing new" in one step.
2. **"Nothing new to send"** is usually correct, not a bug. An item is emailed once and
   then logged; it is only re-sent if the crew edits it. Check the `FeedbackEmailLog` /
   `IncidentEmailLog` tabs: if a uuid is there with a matching hash, it was already sent.
3. **A tab was renamed.** The log prints `Tab not found: ...` or `missing column(s): ...`
   and returns without sending. The script targets **prod** tabs (`JobReports`,
   `Incidents`); the staging sheet uses the `*Staging` names.
4. **The trigger is gone or doubled.** Apps Script editor > Triggers (clock icon). Run
   `installNightlyTrigger()` to fix either case: it deletes existing triggers for both
   the current and legacy handler names before creating one, so re-running it cannot
   leave you with two triggers sending two emails.
5. **The email arrived but an incident had no photo links.** The script reads
   `Incidents.photo_urls` from the sheet, which the backend rebuilds from the `photos`
   table whenever a photo is tagged to an incident. If that column is empty in the
   sheet, the problem is upstream, in the sheet export, not in the script: see
   "Data is not reaching the Google Sheet".
6. **Quota.** A Gmail/Apps Script account has a daily send limit. Exceeding it fails the
   send but the script only writes its log tabs *after* a successful send, so nothing is
   silently marked as delivered. It goes out on the next run.

Data impact: none. Nothing is deleted, and an email that fails to send stays unlogged
and is retried the next night.

---

## Crew can't present or email a signed BOL

Symptoms: a driver needs the signed Bill of Lading in the field (for example a
DOT officer at a border wants the signed contract with addresses), or "Send to
client" on the BOL fails.

The signed BOL card ("Signed Bill of Lading") appears in the BOL editor as soon
as the BOL is signed at origin. See [ADR 0022](decisions/0022-signed-bol-is-retrievable-and-emailable.md).

1. **Presenting the signed BOL never needs signal.** "View / download signed BOL"
   regenerates the PDF on-device from the local draft (signatures + addresses are
   all local). If it does not appear, the BOL is still in `draft` (not signed at
   origin yet) - the card only shows past `draft`.
2. **Addresses / details missing on the document.** The FMCSA-required fields
   (shipper, addresses, payment, valuation, estimate type, agreed dates) are
   entered in the BOL detail cards *before* origin signing, and origin signing is
   blocked until they are filled (ADR 0023). For a BOL signed before this feature,
   the addresses are still editable on the "Signed Bill of Lading" card: enter
   them, tap **Save addresses** (regenerates the Drive copy), then View / download
   to present the corrected copy.
2b. **"Can't sign at origin."** The app names the missing card in the error
   ("Enter the shipper name in Shipper & shipment", etc.). Fill that field and
   retry; this is a required-field gate, not a bug.
3. **"Send to client" fails.** It needs connectivity (email cannot be sent
   offline) - the crew should use View / download to hand over a copy instead, and
   email later. A bad address returns a clear "valid email" message; a mail-send
   failure returns "Could not send." If every send fails, the mailer is the likely
   cause: verify `POSTMARK_SERVER_TOKEN` and `SMTP_FROM` (a verified Postmark
   sender) on the backend - the same credentials password-reset email uses. Grep
   Render logs for `[bol] emailed`.
4. **"BOL not found" on send.** The signed row had not reached the server yet; the
   send drains the queue first, so retrying once online usually clears it.

5. **Wrong company name / address / DOT on the BOL.** The carrier block is
   admin-configurable: Admin > Settings > Company information. Edit and Save; it
   applies to all devices on next load and the crew app caches it for offline. A
   blank field falls back to the built-in default (see `backend/app/core/company.py`
   / `frontend/src/lib/companyInfo.ts`).

Data impact: none. Retrieval is read-only; email sends a copy and changes nothing.

---

## Promotion gate (CI)

`.github/workflows/promotion-gate.yml` runs on every PR targeting `main`. It runs
three jobs: repo invariants (`scripts/promotion_gate.py`), the frontend build, and
a backend byte-compile.

**The workflow reports; it does not block.** Blocking is a branch protection rule,
and it is a ONE-TIME setup on GitHub that has to be done by hand:

1. Repo → **Settings** → **Branches** → **Add branch ruleset** (or Add rule) for
   `main`.
2. Enable **Require status checks to pass before merging**.
3. Add these three checks by name (they only appear in the list after the workflow
   has run at least once, so open a throwaway PR first if the search is empty):
   - `Repo invariants (ADRs, migrations, data-flow)`
   - `Frontend build (tsc + vite)`
   - `Backend compiles`
4. Enable **Require branches to be up to date before merging**, so a check cannot
   pass against a stale base.
5. Leave **Do not allow bypassing** OFF unless you want to lock yourself out of
   your own emergency hotfix path. As the repo owner you can otherwise override,
   which is the right tradeoff for a one-maintainer repo with crews in the field.

Do this on `Jcrooks24` (the primary). The `management909` mirror is a mirror; it
does not need a ruleset.

### Running it locally before opening the PR

```
python scripts/promotion_gate.py --base-ref origin/main
```

Same checks, same exit code. Do this first: a failing gate on a PR is just a
slower way to learn the same thing.

### Clearing a blocker

Fix it, or record a waiver in `docs/DATA_FLOW_STAGING.md`:

```
GATE-WAIVER: <check-id> <reason, including who decided and when>
```

The check-id is printed in the failure (`adr-collision`, `data-flow-deviations`,
etc.). A reason under 15 characters is rejected, deliberately: a waiver with no
reasoning is how a blocker becomes permanent. Per VETTING_PROTOCOL, an agent
cannot waive its own finding.

### What the gate does NOT do

It is the mechanical subset of [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md). Green
means nothing mechanical is obviously broken. It cannot tell you whether a queue
drains, whether a signed BOL survives a worker recycle, whether staging and prod
resolve different Drive folders, or whether a screen is legible in sunlight.
**Run `/vet` before promoting.** Treating a green gate as a vet is how the
durability bugs shipped the first time.

## Known defects

Live bugs that are known and not yet fixed. If you hit one of these, you have found
a real issue, not a misunderstanding. Keep this list honest: delete an entry when it
is fixed, and add one when a `/vet` pass finds something you cannot fix that day.

1. **DQ documents are world-readable to anyone with the link.** Every DQ upload
   gets a Drive `{"type": "anyone", "role": "reader"}` permission
   (`drive_upload.py::upload_dq_file_to_drive`). These are medical cards,
   employment applications and MVRs - PII, and DOT compliance records. Anyone
   holding a `drive_url` can open one without authenticating.

   It is this way because the frontend links straight to `webViewLink`
   (`DqFilesTab.tsx:173`, `DqMyFileCard.tsx:126`), so a driver opening their own
   medical card needs the link to work with no Google account. Removing the
   permission without changing that breaks viewing for every driver.

   The fix is to proxy downloads through an authenticated backend route
   (`GET /api/dq/{id}/file`, role-gated the way the rest of DQ already is) and
   stop granting public reader. That is its own change with its own ADR, not a
   one-line edit. Found 2026-08-10 while moving DQ files to their own folder;
   the folder move neither caused nor worsened it.

2. **The nightly sheet-integrity cron is OOM-killed on every run (prod/`main`).**
   `sheet_integrity_check.py` exits 137 on the 512 MB Render Cron Job, so the
   canary that is supposed to catch Sheet drift is not running at all. **Nothing
   is watching the mirror right now** - treat the 2026-08-05 audit class
   (header overwrites, duplicate rows) as undetected, not as absent.

   One fix has already been made and was **real but insufficient**: the structural
   pass no longer reads whole tabs, only `{tab}!1:1` and one key column
   (`_header` / `_column`). It still OOMs after that change.

   **Do not fix this by reading it again.** Two rounds have now been spent on
   inspection. The job now prints `[mem]` RSS checkpoints (see
   `app/core/memprobe.py`) before each tab and around each pass, unbuffered, so
   the last line in the Render log before the kill names the culprit. Get that log
   first. **This instrumentation is on `staging` and reaches the cron only at the
   next promotion** - the Cron Job deploys from `main`.

   The standing suspect, to be confirmed or killed by that log rather than acted
   on: every `_src_*` in `sheet_backfill.py` is a full-table `.all()` of ORM
   entities, seventeen of them run in sequence, and they all share the one Session
   opened at `sheet_integrity_check.py:176`. SQLAlchemy's identity map holds a
   strong reference to every row loaded by every earlier sync until that session
   closes, so the audit's memory only grows. `JobReport` is 19 Text/JSON columns
   of 28; `Estimate` is 44 columns. If the log shows a `total=` that climbs across
   the `audit: loaded source ...` lines and never falls, that is it.

2. **The crew bottom nav drifts upward on scroll, on mobile (prod/`main`).**
   The nav is `position: fixed; left/right/bottom: 0; zIndex: 50`, styled inline
   at `BottomNav.tsx:72-78`. It is mounted app-wide at `main.tsx:81`, outside
   `<Routes>`, so it is a sibling of every page rather than a child of one.

   **The containing-block hypothesis is dead. Do not retry it.** The suspect was
   `html, body { overflow-x: clip }` establishing a containing block for
   `position: fixed` descendants. That rule is gone (moved to `.fullBleedClip`,
   commit `dfd5ab8`, on both branches), the built bundle confirms it, and the nav
   still drifts. A full ancestor audit on 2026-08-11 closed the rest of that
   class: the nav's real DOM chain is only `html > body > div#root`; `#root` has
   no CSS rules at all; `ThemeProvider` touches `documentElement` only via
   `setProperty` on custom properties; and the codebase's single `backdrop-filter`
   (`Admin.tsx:170`) is not an ancestor and sits behind a route the nav hides on
   anyway. No `transform`, `filter`, `perspective`, `will-change`, `contain` or
   non-`visible` `overflow` exists anywhere on that chain.

   **Rule out a stale precached bundle before diagnosing further** (Profile →
   Update app, then fully close and reopen). Note this is a *prod* symptom and the
   staging service-worker freeze does **not** apply here: the prod host returns
   `200` for `/sw.js` with no redirect (checked 2026-08-11), so the update path
   genuinely works. That makes the device test trustworthy on prod in a way it
   never was on staging.

   If it survives that, the leading theory is iOS Safari's dynamic toolbar
   resizing the visual viewport under `position: fixed` elements. There is no
   `dvh`, `svh` or `visualViewport` handling anywhere in the codebase to absorb
   it. **Unverified: nobody has reproduced this on an instrumented device.**

2. **`env(safe-area-inset-*)` resolves to 0 on iOS: the viewport meta is missing
   `viewport-fit=cover`.** `frontend/index.html:8` is
   `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
   with no `viewport-fit=cover`. Confirmed identical in `frontend/dist/index.html`
   and in the live prod HTML on 2026-08-11. Without it iOS keeps the default
   `viewport-fit=auto` and every `env(safe-area-inset-*)` in the app evaluates
   to `0`.

   Two places silently do nothing on a notched iPhone as a result:
   `BottomNav.tsx:77` (`paddingBottom: env(safe-area-inset-bottom)`) and
   `index.css:68` (`body { padding-bottom: calc(56px + env(safe-area-inset-bottom)) }`).
   The nav reserves no room for the home indicator, and the page reserves no room
   for the nav beyond a flat 56px. `UpdateBanner.tsx:114` offsets itself from the
   same dead value.

   **Separate defect from the drift above, and not the fix for it** - a zero inset
   changes how much padding the nav has, not where a `position: fixed` element is
   anchored. Found while auditing the drift. Deliberately not fixed yet: adding
   `viewport-fit=cover` shifts the nav's layout on every iOS device, which would
   confound the drift device-test that has not been run. Fix it after that test,
   not before.

2. **The long-distance day queue never drains: `drive_day` never reaches the server.**
   `LdWorkday.tsx:70` calls `setLdDay()` when the crew picks "Driving" in the LD day
   plan. That writes `crew_ld_day_v1:<date>` and pushes an upsert onto
   `crew_ld_day_queue_v1`. **Nothing in the app calls `ldDayStore.syncQueue()`** -
   no component imports it, and the only internal caller is `retryFailedLdDay`,
   which is itself uncalled. `POST /api/long-distance/day` therefore never fires
   from the app, and `long_distance.py:375` is the only place `LdDay` rows are
   created.

   **Symptoms:** the `LdDays` table stays empty, the `LongDistancePay` tab stays
   empty, Admin's job summary shows "Per-diem days: 0 · Drive days: 0"
   (`Admin.tsx:7154`) no matter what the crew selected, and `crew_ld_day_queue_v1`
   grows on every Driving toggle and never empties.

   **Not a payroll-money bug.** `payroll.py::_per_diem_nights` takes per-diem
   primarily from the per-employee `out_of_town` flag on job-report hours and only
   supplements from `LdDay`, so pay is correct. **Confirmed with the owner
   2026-08-11: payroll showing "per-diem 0" for everyone on `main` is not a
   defect - no out-of-town nights have actually been logged yet.** Do not go
   looking for a payroll bug behind that zero until someone has logged one. The real loss is `drive_day`, which
   has no other source. Note also that `setLdDay` is only ever called with
   `drive_day`; `out_of_town` is never written locally either, so fixing the drain
   alone leaves that half of the record empty.

   **Confirmed on both `main` (`72b544a`) and `staging`.** Found 2026-08-06 while
   mapping data flow, not fixed. Fix is to call a drain from `App.tsx`'s boot and
   `online` handlers alongside the other queues, and to decide where `out_of_town`
   should be written. See [DATA_FLOW.md](DATA_FLOW.md) Deviations.

2. **The estimator queue drains only while its tab is mounted.** `estimatorQueue.drain`
   is called from `EstimatorTab.tsx:524` on mount and on `estimate_uuid` change, and
   from nowhere else. It has **no `online` listener**, so an item queued offline does
   not ship on reconnect the way every other queue does; it waits for somebody to
   reopen that specific estimate.

   **Symptom:** an estimator item added with no signal is still "Syncing…" hours
   later, and the crew member has no reason to suspect reopening the estimate is what
   releases it. `pruneStale` deletes queue entries after 14 days, so an estimate never
   reopened inside that window loses the item silently.

   This is the exact failure class [ARCHITECTURE.md](ARCHITECTURE.md) warns about
   under "A queue must not depend on its own UI being mounted", and the same shape as
   the job-inventory bug that `drainAll()` was written to fix (ADR 0015). Fix is the
   same: expose a `drainAll()` and call it from `App.tsx`'s boot and `online`
   handlers. Affects `main` (`72b544a`) and `staging`. Found 2026-08-06.

2. **A failed sheet write on an event note/timestamp edit is never retried.**
   `PATCH /api/events/{id}` (`sync.py:266`) commits Postgres, then calls
   `update_event_note_in_sheets` / `update_event_timestamp_in_sheets`
   **synchronously**, catches any exception, and returns it as a `sheet_error` field
   the client ignores. The auto-reconciler covers missing event **rows**, not stale
   event **cells**, so nothing ever re-drives it.

   **Symptom:** a crew member corrects a note or a clock time, the app confirms it,
   Postgres is right, and the Events tab keeps showing the old value indefinitely.
   Admin reading the Sheet sees the pre-correction value with no indication it is
   stale. Only another edit to the same event fixes it.

   Postgres being the source of truth means nothing is lost, but the Sheet is what
   admin actually reads. Affects `main` (`72b544a`) and `staging`. Found 2026-08-06
   while mapping data flow. See [DATA_FLOW.md](DATA_FLOW.md) Deviations.

2. **Availability cannot be submitted offline, and fails silently to the crew's eye.**
   `availabilityStore.submitDraft` is a direct `POST /api/availability` with no queue
   and no drain (Class B in [DATA_FLOW.md](DATA_FLOW.md)). The draft persists in
   `crew_availability_draft_v1`, the transmission does not happen, and there is
   nothing to retry on reconnect.

   This is by design, not a regression, but it is the only crew-facing **submission**
   in the app with no offline path, so a crew member reporting "I submitted my
   availability and it vanished" has found this, not a bug in the picker. Worth
   deciding whether it should get an outbox like everything else. Affects `main` and
   `staging`.

2. **Staging PWA serves STALE code: fixes look "not deployed" when they are.**
   The staging frontend is a Vercel **branch-preview** deployment
   (`mountaineer-crew-app-git-staging-*.vercel.app`), and that host has **Vercel
   Deployment Protection (Vercel Authentication)** on. Every request to it, including
   `/sw.js`, gets a **302 redirect to Vercel SSO** (confirm:
   `curl -I https://<staging-host>/sw.js` → `302` + `Location: vercel.com/sso-api`).
   The service-worker spec forbids the SW script being behind a redirect, so the
   browser's SW **update check fails** ("The script resource is behind a redirect,
   which is disallowed"). The already-installed SW then keeps serving the **precached
   old bundle**, and because `registerType` is `"prompt"`, the update banner never
   appears and even Profile → **Update app** (`reg.update()`) fails the same way.

   **Symptom this causes:** a fix is committed and live on Vercel, but on-device it
   looks unchanged across multiple "fixes." This is what made *truck-fullness → invoice
   auto-populate* look broken three times when the code (commit `559108f`) was correct
   and deployed the whole time (backend decode + frontend effect both verified
   2026-07-16).

   **Why now, not before (root cause):** the service worker is not new (added in
   `3d4df71`, config stable since). It worked for months because `/sw.js` used to serve
   `200` - the SW updated on every deploy. Vercel later enabled Deployment Protection on
   the preview host (a platform default flip on lower tiers; it cannot be turned off on
   this account's tier), so `/sw.js` began returning the SSO 302. That **froze the SW
   that had installed back when the path served 200** - it now replays its pre-protection
   precache. Nobody changed the app; the hosting gate changed.

   **The fix is one-time, and needs no second project or code change.** Because
   protection now also blocks a *new* SW from installing (its registration fetch hits the
   same 302 and fails), once you remove the stale worker nothing re-traps it:
   - **Unregister the stale SW once:** DevTools → Application → Service Workers →
     **Unregister**, then reload (or "Clear site data" for the host; incognito also
     bypasses it for a quick check).
   - After that, **no SW can install while protection is on**, so staging serves fresh
     from the network on every load. You do not have to repeat this per deploy. The only
     loss is offline capability *on the staging URL* (real offline-first still ships on
     production).

   **If you ever want the SW / offline behavior back on staging** (no tier upgrade):
   serve staging from an unprotected **production domain** - a second Vercel project with
   Production Branch = `staging` and the staging env vars; its production URL is public
   under Standard Protection. Not required just to see deploys.

   Either way, treat "it didn't change on staging" as *stale SW first, code bug second* -
   verify against the committed source or an incognito load before assuming a fix did not
   land.

2. **Logging out destroys unsynced photos and reimbursements.** `clearCrewState()`
   deletes the entire IndexedDB database. A crew member who logs out with a pending
   receipt photo loses it permanently. **Never tell a crew member to log out or
   reinstall as a troubleshooting step** unless you have confirmed their queues are
   empty. (The localStorage BOL queue + drafts ARE now preserved across a logout per
   [ADR 0021](decisions/0021-preserve-pending-bol-work-on-logout.md); the IndexedDB
   photo/reimbursement blobs still are NOT - preserving those across `deleteDatabase`
   is the remaining piece.)

2. **BOL durability - fixed 2026-07-16, with two narrow follow-ups.** A signed BOL that
   reached neither the sheet nor Drive drove a lifecycle trace and a batch of fixes
   ([ADR 0020](decisions/0020-bol-durability-and-honest-failures.md) /
   [ADR 0021](decisions/0021-preserve-pending-bol-work-on-logout.md)): honest 5xx
   status codes, a durable BOL reconciler (auto + `POST /api/admin/sheets/reconcile-bols`
   + `POST /api/admin/bol/{bol_id}/reexport`), write-first-then-delete-stale export
   ordering, `DRIVE_BOL_FOLDER_ID` per environment, pending-BOL preservation on logout,
   draft cleanup, and quota-failure surfacing. A vet pass then hardened it further:
   the exporter now marks the `bol`/`bol_item` dedupe keys only AFTER both tabs are
   written (a crash mid-export leaves no dedupe row, so the reconciler re-ships it -
   the earlier "summary present, items missing" gap is closed), the reconciler uses
   keyset pagination so failing low-id BOLs can't starve others, `discardFailedBol`
   drops the whole bol_id sequence, and `syncQueue` won't resurrect the queue after a
   logout. **Remaining accepted low-severity items:** (a) a same-timestamp re-export
   (rare) can leave a duplicate summary row that only clears on the next real change;
   (b) a Drive upload that succeeds but whose DB commit then fails orphans a duplicate
   PDF in the signed-BOL folder on the retry (clutter, latest link still recorded);
   (c) the `LIKE bol_id||':%'` reconcile/export scoping does not escape LIKE
   metachars - harmless for UUID/hash bol_ids, defensive-only; (d) the BOL reconnect
   photo-retry still has a narrow window where an item added DURING the reconnect
   upload could be dropped (the mount-time staleness is fixed; this residual is one
   async tick wide). **Action still required by a human:** set `DRIVE_BOL_FOLDER_ID`
   on BOTH Render services (staging + prod, different folder ids) - until then staging
   shares prod's signed-BOL folder. See CREDENTIALS.md.

2. **RESOLVED 2026-07-15: queued work is no longer dropped on a 4xx.** All ten offline
   queues now mark a rejected op `failed` and keep it, per
   [ADR 0013](decisions/0013-rejected-queue-work-is-never-deleted.md). A backend
   validation change can no longer silently delete queued field work. The `pruneStale`
   14-day sweep in `estimatorQueue` / `jobInventoryQueue` now exempts failed entries too.

   **Remaining follow-ups (surfacing only, no data loss). All failed work is KEPT and
   retryable via each store's API; these are missing UI:**
   - `rodsStore` and `ldDayStore` ops have no crew-facing failed-op screen yet (the
     stores export `failedDays`/`retryFailedDay`/`discardFailedDay` etc.). `bolStore`
     now HAS one (the failed-BOL banner in `BillOfLadingForm`).
   - `estimatorQueue`: a permanently-failed item reappears on reload as a "Syncing…" row
     (the on-mount merge doesn't mark failed ops), so it looks stuck rather than failed.
     Delete-the-row is the discard; re-adding is the retry.
   - `materialsStore` / `officeHoursStore`: a failed *delete* (uncommon - needs a 4xx on
     DELETE) is not surfaced; it just stops hiding the item. Failed adds/upserts are
     surfaced correctly.

   **User-switch preservation (added 2026-07-15):** a shared-phone user switch wipes the
   departing user's queues (`clearCrewState`), which would delete their FAILED work - the
   very work ADR 0013 keeps for a human to retry. `auth/preserveFailedWork.ts` now
   snapshots the departing user's failed localStorage-queue entries under a wipe-proof
   `keepfailed_v1:<id>` key and restores them when that user next logs in on the device.
   Pending (not-failed) work is intentionally NOT preserved - it drains normally, and
   preserving it would risk syncing it under the new user. **Gap:** the IndexedDB queues
   (reimbursements with photo blobs) are still wiped on a switch without preservation;
   preserving those across the wholesale `deleteDatabase` is a larger change.

   Any *new* queue must honor ADR 0013 from the start - the rule binds the queue you are
   about to write, not just the ones listed here. **A new localStorage queue must also be
   added to `QUEUE_KEYS` in `preserveFailedWork.ts`** or its failed work is lost on a
   user switch.

   **Note the production gap:** the reimbursement fix was hotfixed to `main`
   (`724e3e1`), but the five above are unfixed on **both** branches, so this is losing
   crew data in production today, not just in staging.

3. **Coalescer workers can leak an in-flight key if `record_sheet_sync` raises (low risk).**
   The incident / availability / BOL sheet-export workers in
   `backend/app/integrations/sheets_export.py` call `record_sheet_sync(...)` in their
   `except` block without a guard. If *that* call raised (e.g. the DB session is in a
   failed-transaction state), the exception escapes before the `with _*_export_lock`
   cleanup runs, so the entity's key stays in `_*_export_in_flight` forever and every
   later `schedule_*_export` for it no-ops (adds to rerun, never runs). Low probability
   in practice: the common failure is a Sheets 429, which happens *after* the export's
   internal commit, on a clean session. Fix when convenient: wrap the whole worker body
   (export + both record_sheet_sync calls) so the in-flight/rerun cleanup always runs in
   a `finally`. Applies to all three coalescers.

4. **Estimates created before 2026-07-13 may carry inflated totals. This is known and
   accepted; do not "discover" it and panic.**

   Item adds used to double-count the newly added item into the estimate's rolled-up
   weight and volume. Item counts were always correct; only `estimated_weight_lbs` and
   `estimated_cubic_ft` inflated, by exactly the last-added item's contribution. Fixed
   2026-07-13, so **every estimate created from that date forward is correct.**

   **The owner decided not to backfill the historical rows.** Those estimates are
   quoting documents that have already served their purpose, and any of them heals
   itself the moment someone edits or deletes an item on it (patch and delete always
   recalculated correctly).

   The one live consequence: an old estimate feeding the est-vs-actual overage
   comparison will read slightly heavy on the estimated side. If a specific old
   estimate's numbers look wrong and you need it corrected, run
   `backend/scripts/recalc_estimate_totals.py --dry-run` (then without the flag) for
   that environment. It is idempotent and safe, just not required.

5. **Payroll: hours belonging to a name that matches nobody on the roster are not
   counted. The page warns; it does not guess.**

   Per-employee hours on a job report written before the rows carried a `user_id`
   have only a name string. The payroll aggregator matches those against the roster
   by lowercased name, and anything that still does not match is surfaced in the
   yellow "Check these first" panel by name.

   **Those hours are excluded from the totals.** That is deliberate - inventing a
   match would pay the wrong person - but it means an admin who ignores the warning
   underpays somebody. Fix the name on the job report, or add the person to the
   roster, then reload the period.

6. **Payroll: a job with NO synced timeline events, whose report is first edited
   more than 14 days after the pay period ends, is missed.**

   Jobs are found by their events, which is what keeps the query bounded to the pay
   period. A second query catches jobs that never synced an event, bounded to the
   period plus `NO_EVENT_REPORT_GRACE_DAYS` (14) so it cannot degrade into a full
   table scan. A manual job with no events at all, whose report nobody touched until
   more than two weeks after the period closed, falls outside both.

   Realistically unreachable: payroll runs within days of a period closing, and any
   job the crew ran a timeline on is found precisely regardless of when its report was
   edited. If it ever does bite, raise the constant in `routers/payroll.py` and note
   the new scan cost here.

### Recently fixed (kept briefly so you do not re-report them)

- BOL self-overwrite when a job ran with two trucks. Fixed 2026-07-27 (staging,
  [ADR 0024](decisions/0024-bol-guards-against-self-overwrite.md)): the manual-job
  start path (`startManual`) blanked the local draft and, on save, the server replaced
  the first truck's inventory with an empty list. Both start paths now confirm before
  opening an existing BOL (continue, don't blank), and the server refuses an
  empty-over-non-empty item save with a 409.
- Job photos not auto-retrying on reconnect. Fixed 2026-07-13: the `online` handler
  now drains them like every other queue.
- Estimator and job-inventory item queues not being idempotent. Fixed 2026-07-13:
  both now send a client-minted `item_uuid` and the endpoints upsert on it.
- `alembic revision --autogenerate` emitting spurious `DROP TABLE`. Fixed 2026-07-13:
  the seven missing model imports were added to `alembic/env.py`. Still worth reading
  any generated migration before applying it.
- OOM-hardening pass, 2026-07-16 (staging). After the availability-export coalescing
  fix (`ca206ef`), a full audit closed the rest of the grows-with-data and per-request
  memory vectors on the 512 MB worker:
  - Availability sheet export read the entire tab (`A:Z`, all 26 columns x every row)
    each run; now reads only the two dedup key columns.
  - `GET /api/availability/all` and the per-user state read scanned the forever-growing
    `availability_days` table unbounded; both are floored to recent history and the
    audit scan is hard-capped. `admin/.../range` now rejects spans over 92 days.
  - BOL sheet export is now coalesced (`schedule_bol_export`) like incidents/inventory,
    so a shared-device signing burst can't interleave into duplicate rows or pile
    unbounded tasks on the 2-worker pool.
  - `GET /api/dvir` list deferred/blanked the base64 driver+mechanic signatures (up to
    ~30 MB across a 1000-row page); single-DVIR GET still returns them.
  - Furniture CSV import streams the upload through a `TextIOWrapper` instead of
    triple-buffering the whole body.
  - Per-job scans in bill-seed / job-inventory / job-report are capped.
  - `drive_upload` now builds the Drive service per-thread (it was one process-wide
    httplib2 service shared across concurrent upload threads - the same
    OpenSSL-not-thread-safe crash the sheets service already avoids).

  **Accepted, not fixed (low priority):** every replace-style sheet export still does
  two full-spreadsheet metadata `get`s plus a full single-column read in
  `_delete_sheet_rows_by_value`, so per-export cost grows slowly with each tab. And
  `GET /api/users/directory` still returns `profile_photo` data URLs (bounded to 200,
  client-cached) because the crew avatar feature depends on them; dropping the field
  would need a separate per-photo fetch endpoint first.
