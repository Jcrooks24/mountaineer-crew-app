# Credential and access inventory

**This file contains no secret values, and never will.** It is the map, not the
keys. It tells a successor what secrets exist, what breaks without each one, who
issues them, and how to rotate them.

> **Where the actual secrets live**
>
> - **Password manager** (1Password / Bitwarden): the human logins (Google
>   Workspace, Render, Vercel, Postmark, GitHub) and any recovery codes. Set up
>   **emergency access / legacy contact** on this vault so it is reachable if the
>   owner is not. That mechanism, not this document, is the bus-factor plan for
>   secrets.
> - **Render and Vercel environment variables**: the runtime secrets the app reads.
>   These are the live source of truth for anything in the tables below.
>
> Committing a secret value to this repo, even briefly, means rotating it. Git
> history is forever.

## Accounts a successor needs

Fill in the owner column. These cannot be reconstructed from code.

| Account | What it gates | Owner / where to get in |
|---|---|---|
| GitHub (`Jcrooks24/mountaineer-crew-app`) | The code, and push access that triggers deploys | TODO |
| Render | Both backend services, both Postgres databases, all backend env vars, logs | TODO |
| Vercel | Both frontends, frontend env vars, build logs | TODO |
| Google Workspace / Cloud project | The Sheet, Drive, Calendar, the Maps key, the OAuth client | TODO |
| Postmark | Outbound email. Without it, nobody can reset a password. | TODO |
| Password manager | Everything above | TODO (set emergency access) |

## Backend runtime secrets (Render, per service)

Set on **both** the prod and the staging service, with different values.

| Variable | Required | Breaks what, if wrong or missing |
|---|---|---|
| `DATABASE_URL` | Yes | Everything. Postgres connection string. If unset the app silently falls back to local SQLite, which in a deploy means data goes nowhere real. |
| `JWT_SECRET` | Yes | Nobody can log in. The app **refuses to boot** if `DATABASE_URL` is set and this is not, which is intentional (fail closed rather than sign tokens with a dev default). Rotating it logs every crew member out. |
| `FRONTEND_URL` | Yes | Password-reset and mechanic-signature links. A stale value here points crew at the wrong environment's frontend and they get "invalid or expired reset link", because the token is in the other database. This has actually happened after a promotion. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Yes | The office sees nothing. The target spreadsheet for every export. |
| `POSTMARK_SERVER_TOKEN` | Yes in deploys | Password-reset email, the "Send to client" email of a signed BOL, **and** the payroll correction emails sent by Admin -> Payroll -> Finalize. With it unset the mailer prints to stdout in dev mode and sends nothing, silently. Payroll finalize is the exception: it checks this token and `SMTP_FROM` up front and refuses with a 503 rather than silently "notifying" crew via stdout, because stamping a correction as sent when it was not is unrecoverable. |
| `SMTP_FROM` | Yes in deploys | The from-address on Postmark sends (password reset, signed-BOL email, payroll corrections). Must be a verified Postmark sender. Name is legacy; no SMTP is involved. |
| `ADMIN_EMAIL` | Recommended | The user auto-promoted to admin on every startup. Your way back in if you lose admin. |
| `GOOGLE_MAPS_API_KEY` | Optional | Drive-time, mileage auto-calc, and address lookup. Degrades gracefully: routes return `ok: false` and the UI falls back to manual entry or free OSM routing. `MAPS_API_KEY` is accepted as a fallback name in `routing.py` only. |
| `GOOGLE_OAUTH_TOKEN_JSON` | Fallback only | Google API access. **The primary source is the `system_config` table** (key `google_oauth_token`), pasted in via Admin. This env var is only consulted if that row is absent. See rotation below. |
| `DISPATCH_ADDRESS` | Optional | Default return-trip destination. Defaults to the Bozeman yard in code. |
| `WORKSPACE_CALENDAR_ID` | Optional | Which Google Calendar the day's jobs are read from. Defaults to `primary`. |
| `CREW_RESOURCES_ENABLED` | Optional | Must be `true` to run the hourly crew-resources calendar loop. Off otherwise. |
| `RESOURCES_CALENDAR_ID`, `JOBS_CALENDAR_ID`, `IGNORED_INVITEE_EMAILS` | Optional | Only used by the crew-resources loop. |
| `SQLITE_PATH` | Local only | Local dev database file. Never set in a deploy. |

### Sheet tab variables (Render backend)

**Every one of these defaults to the production tab name.** On staging, each must
be set to the `*Staging` value or staging test data lands in the office's real
sheet. This is the most common configuration mistake in this system.

`SHEETS_EVENTS_TAB`, `SHEETS_MATERIALS_TAB`, `SHEETS_JOB_REPORTS_TAB`,
`SHEETS_BILLS_TAB`, `SHEETS_DVIRS_TAB`, `SHEETS_PRIOR_HOURS_TAB`, `SHEETS_RODS_TAB`,
`SHEETS_LD_PAY_TAB`, `SHEETS_ESTIMATES_TAB`, `SHEETS_ESTIMATE_ITEMS_TAB`,
`SHEETS_BOLS_TAB`, `SHEETS_BOL_ITEMS_TAB`, `SHEETS_JOB_INVENTORY_TAB`,
`SHEETS_JOB_INVENTORY_ITEMS_TAB`, `SHEETS_INCIDENTS_TAB`, `SHEETS_OFFICE_HOURS_TAB`,
`SHEETS_REIMBURSEMENTS_TAB`, `SHEETS_AVAILABILITY_TAB`, `SHEETS_OFF_JOB_TAB`,
`SHEETS_BUGS_TAB` (default `Bugs`; the Report-a-Bug feature)

Staging value is the production name plus `Staging` (`Events` → `EventsStaging`).

Admin → Advanced Settings → System Check → Sheet Syncs lists which are unset.
Check it after any deploy that adds a new tab.

**Live prod tab names that DON'T match the code default (authoritative, do not
"correct" them).** These Render env vars were set to camelCase values, so the
office's real data lives in the camelCase tabs, not the PascalCase code defaults.
Renaming them (tab + env var) is a live migration; the 2026-08-05 audit chose to
leave them and record reality here instead:

| Env var | Live prod tab (has the data) | Code default (unused) |
|---|---|---|
| `SHEETS_INCIDENTS_TAB` | `incidents` | `Incidents` |
| `SHEETS_JOB_INVENTORY_TAB` | `jobInventory` | `JobInventory` |
| `SHEETS_JOB_INVENTORY_ITEMS_TAB` | `jobInventoryItems` | `JobInventoryItems` |
| `SHEETS_OFF_JOB_TAB` | `offJob` | `OffJobHours` |

The empty `OffJobHours` / `Incidents` / etc. PascalCase tabs (created by a default
before the env var was pointed at the camelCase name) are junk; the cleanup tool
(`backend/scripts/cleanup_sheet.py --step tabs`) removes the empty strays.

### Sheet integrity check (Render Cron Job) - keeps the mirror clean

`backend/scripts/sheet_integrity_check.py` does two things. **Structural:**
re-derives each tab's expected shape from the code's own `*_HEADERS` and asserts
it against the live sheet (missing KEY column = a `dfg`-style overwrite, duplicate
rows on a one-per-key tab, or a junk env-var-named tab = FAIL; missing non-key
columns and blank residue = WARN). **Completeness (server -> sheet):** reuses the
app's own reconciler (`audit_sheet_backfill` + the Events/BOL counters) to confirm
every current Postgres record is present in the sheet - a missing record is a FAIL,
because the Sheet is the durable copy and that record could be lost if the DB ages
out before it syncs. On any FAIL it emails `ALERT_EMAIL`; exit code is non-zero on
FAIL. `--no-completeness` runs structural checks only.

Run it nightly as a **Render Cron Job** (a separate service; Root Directory
`backend`, so no `backend/` prefix on the command):

    Command:   python scripts/sheet_integrity_check.py
    Schedule:  0 5 * * *      # daily, ~11pm MT (Render cron is UTC)

Give the Cron Job the **same environment as the prod backend service** so it reads
the same tabs, plus one addition:

| Variable | Value |
|---|---|
| `ALERT_EMAIL` | `jacob@mountaineermoving.com` - the only alert recipient (defaults to this in code). |

It reuses `DATABASE_URL` (to read the Google token), `GOOGLE_SHEETS_SPREADSHEET_ID`,
`POSTMARK_SERVER_TOKEN`, `SMTP_FROM`, and the `SHEETS_*_TAB` set from that service.
Matching the prod backend's `SHEETS_*_TAB` values is load-bearing: the four
camelCase tabs (`incidents`, `jobInventory`, ...) must be set or the check reads
the wrong (empty) tabs and misses real drift. Related but different: Admin ->
System Check, Sheet Syncs (`SHEET_SYNC_REGISTRY`) answers "is the sync working";
this answers "is the data clean".

### Drive folder variables (Render backend)

| Variable | Effect if unset |
|---|---|
| `DRIVE_PARENT_FOLDER_NAME` | Defaults to "Mountaineer Crew Photos". The folder id is then cached in `system_config`. |
| `DRIVE_ESTIMATOR_PARENT_FOLDER_ID` | Estimator photos fall back into the crew-photos parent. Functional, just messier. |
| `DRIVE_REIMBURSEMENT_PARENT_FOLDER_ID` | Same, for receipt and odometer photos. |
| `DRIVE_DOCUMENTS_FOLDER_NAME` | Defaults to "Mountaineer Crew Documents". **Set a staging-suffixed name on staging** (e.g. "Mountaineer Crew Documents (Staging)"). This folder holds the Document Library AND the Driver Qualification (DQ) files, which include PII (medical cards, employment applications). Resolved by name, so without a staging override, staging test DQ uploads land in the same physical folders as the real drivers' prod documents. (C4 / DQ.) |
| `DRIVE_BOL_FOLDER_ID` | **Set this per environment (staging and prod each their own folder ID).** Signed BOL PDFs land here. If unset, the code falls back to resolving the folder BY NAME (`DRIVE_BOL_FOLDER_NAME`, default "Signed Bills of Lading") - and staging + prod, sharing that name, resolve the SAME real folder, so staging can overwrite production's signed legal documents in place. Use the folder ID (the segment after `/folders/` in the Drive URL). See [ADR 0020](decisions/0020-bol-durability-and-honest-failures.md). |
| `DRIVE_BOL_FOLDER_NAME` | Legacy name-based fallback, used only when `DRIVE_BOL_FOLDER_ID` is unset. Has a code default; do not rely on it across environments. |
| `DRIVE_DQ_FOLDER_ID` | **Set this per environment (staging and prod each their own folder ID).** The top-level folder holding the Driver Qualification files, one subfolder per driver named for that driver, created on their first submission. If unset, DQ uploads fall back to the `DRIVE_DOCUMENTS_FOLDER_NAME` folder, which resolves BY NAME - so staging and prod land in the SAME physical folder. These are DOT compliance records containing PII (medical cards, employment applications), so that fallback is the one to avoid. There is deliberately **no** `DRIVE_DQ_FOLDER_NAME`: a name-based fallback is exactly the hazard. Use the folder ID (the segment after `/folders/` in the Drive URL). |

## Frontend build variables (Vercel, per project)

| Variable | Notes |
|---|---|
| `VITE_API_URL` | The backend origin. **Baked in at build time**, including into the service worker's caching rules, so changing it requires a rebuild, not just a restart. Pointing prod at the staging backend is a way to lose a day of crew data. |
| `VITE_STAGING` | Set to `true` on the **staging project only**. Enables the staging-only "Preview as role" switch (view the app as Crew / Crew Lead / Skill Rater without logging out). Must never be set on prod. **Baked in at build time: setting it in Vercel does nothing until the staging project is redeployed**, and when it is missing the switch renders nothing at all, with no error. Admin → Advanced Settings → **System Check** reports whether it reached the running build. See `frontend/.env.example`. |
| `VITE_BUILD_ID` | Optional. Vercel injects `VERCEL_GIT_COMMIT_SHA` automatically, which the build picks up. |

## Google Cloud specifics

One Cloud project backs everything Google. A successor needs to know:

**APIs that must be enabled.** Missing one does not crash the app, it silently
disables a feature:

| API | Powers | Symptom if not enabled |
|---|---|---|
| Google Sheets API | Every export. The office's entire view. | Nothing reaches the sheet. |
| Google Drive API | Photos, documents, signed BOL PDFs | Uploads fail. |
| Google Calendar API | The day's job list | Crew see no jobs for today. |
| Directions API | Return-trip drive time | Endpoint returns `ok: false`; UI falls back to a Maps deep link. |
| Distance Matrix API | RODS mileage "Auto" button | Miles come back null; the field stays manual. |
| Places API | Address typeahead | Google answers `REQUEST_DENIED`; the field degrades to plain text, silently. |

**The OAuth token is in the database, not in an env var.** Scopes:
`calendar.readonly`, `calendar.events`, `spreadsheets`, `drive.file`. It is stored
in the `system_config` table under key `google_oauth_token` and is refreshed
automatically. `GOOGLE_OAUTH_TOKEN_JSON` is only a fallback.

**Rotating it:** regenerate the token locally with the Google OAuth flow, then paste
it in via Admin → the `/api/admin/cal-token` endpoint. Do this per environment,
since the token lives in each environment's database. If Google access breaks
across the board and nothing else changed, a revoked or expired token is the first
thing to check.

## GitHub Actions secrets (repo: `Jcrooks24/mountaineer-crew-app`)

Set under **Settings > Secrets and variables > Actions**.

| Name | Kind | Powers | Breaks what, if wrong or missing |
|---|---|---|---|
| `GOOGLE_OAUTH_TOKEN_JSON` | Secret | The docs mirror (`.github/workflows/sync-docs-to-drive.yml`) | The Drive copy of the docs stops updating and the Action goes red. Nothing in the running app is affected. **Its value is the same authorized-user JSON stored in `system_config.google_oauth_token`**, so there is no separate credential to create: copy the existing one. |
| `DRIVE_DOCS_FOLDER_NAME` | Variable, optional | The Drive folder the docs land in | Defaults to "Mountaineer Crew App Docs". |

The mirror deliberately uses a **user** token rather than a service account. A service
account has no Drive storage quota and its uploads fail with `storageQuotaExceeded`.
See [ADR 0012](decisions/0012-docs-mirror-oauth-not-service-account.md) before
"simplifying" this.

The Drive folder holds a copy of this file. It contains no secret values, but it is a
complete map of every account and API this system depends on. **Share the folder with
people who would inherit the system, not with "anyone who has the link."**

## Rotation notes

| Secret | On rotation |
|---|---|
| `JWT_SECRET` | Every crew member is logged out and must sign in again. Do it at night, not mid-move. |
| `GOOGLE_MAPS_API_KEY` | Safe. Features degrade during the gap; nothing is lost. |
| `POSTMARK_SERVER_TOKEN` | Safe, but nobody can reset a password until it is back, and payroll finalize refuses to run (by design, with a clear message). Verify the sender signature still matches `SMTP_FROM`. |
| Google OAuth token | Must be repasted per environment. **Also update the `GOOGLE_OAUTH_TOKEN_JSON` GitHub Actions secret**, or the docs mirror keeps using the revoked token and its workflow starts failing. Sheets exports queue up in Postgres and the auto-reconciler backfills them once access returns, so a short outage is recoverable. |
| Database password | Update `DATABASE_URL` on Render. The app will not boot without a valid one. |
