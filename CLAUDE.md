# mountaineer-crew-app

Crew-facing app used in the field on mobile. `backend/` is FastAPI + Postgres + Alembic; `frontend/` is Vite/React. Backend deploys on Render, frontend on Vercel. Synced data lands in a shared Google Sheet.

This file is the **operating manual**: the rules, the invariants, and the procedures. It is not a changelog and not a feature list.

## Documentation map

| Doc | For |
|---|---|
| [README.md](README.md) | The front door. What this is, where it lives, how to run it. Start a successor here. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | What the pieces are and how they talk. Read before changing anything structural. |
| [docs/DATA_FLOW.md](docs/DATA_FLOW.md) | The field-level ledger: for every piece of data, what triggers the exchange and when the transfer happens. Queue keys, drain functions, debounce timings, Sheet export functions, per-field adherence. |
| [docs/RUNBOOKS.md](docs/RUNBOOKS.md) | Step-by-step checklists for when something is broken. Also holds the **Known defects** list. |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Every account, env var, and API. What breaks without each. **No secret values, ever.** |
| [docs/decisions/](docs/decisions/) | Why things are the way they are. **Read before "fixing" something that looks wrong.** |
| [docs/business/](docs/business/) | The company this app serves: who does what, the SOP, the tools audit, the M1 merger assessment. **Read before deciding whether a feature should exist.** |
| [docs/VETTING_PROTOCOL.md](docs/VETTING_PROTOCOL.md) | The pre-promotion test protocol (`/vet`). |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Admin-facing guide: what admin can do in the app. Keep accurate against `Admin.tsx` / `admin.py`. |
| [docs/CREW_GUIDE.md](docs/CREW_GUIDE.md) | Crew-facing reference & troubleshooting guide (every feature + failure modes). Master formatted copy lives in the shared doc. |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | The visual contract: tokens, primitives, patterns. Read before restyling or building a screen. Rationale in [ADR 0025](docs/decisions/0025-enterprise-design-system-facelift.md). |

## Definition of done

A change is not done when the code works. It is done when the next person can still run this system without you. Every change, in the **same commit**:

1. **Code works**, verified by exercising it, not just by typecheck.
2. **New env var, secret, or Google API?** → it is in `docs/CREDENTIALS.md`, and the user has been told to set it on Render/Vercel.
3. **New service, integration, queue, or data flow?** → `docs/ARCHITECTURE.md` and its diagram still match reality.
   **Touched a queue, a drain trigger, a debounce timing, an endpoint, or a Sheet export path?** → `docs/DATA_FLOW.md` is updated in the same commit, including the per-field table for that domain. Adding a field to a payload without adding it there is how that doc goes stale.
4. **Made a decision someone would be tempted to undo?** → write the ADR in `docs/decisions/` now. Apply the test in that folder's README.
5. **Found a bug you did not fix?** → add it to Known defects in `docs/RUNBOOKS.md`. **Fixed one that is listed?** → delete the entry.
6. **Changed setup, local dev, or deploy?** → `README.md` is current.

Run **`/handoff`** at the end of a working session to sweep all of this. Run **`/vet`** before promoting to `main`.

## Branch rule

**All pushes go to `staging`. Never push to `main` unless explicitly instructed to promote.**

`main` is production. `staging` is for testing and debugging new features before they reach crew devices. Default target for commits and PRs is `staging`.

## Core invariants (must be preserved on any change)

- **Offline-first.** The app must work offline without data loss and sync when back online.
- **Synced data lands in the Google Sheet** (ID `1KDWNudFSc8tlqV7lzq-M235swkgq7jWg_63ilrw_9hk`). Staging writes to `*Staging`-suffixed worksheets (`EventsStaging`, `MaterialsStaging`, etc.); production writes to the unsuffixed ones. The split is controlled by env vars, do not hardcode worksheet names.
- **Crew auth:** login, logout, and password reset must keep working end-to-end.
- **Field-grade reliability.** Quality is priority #1, prefer boring, well-tested paths over clever ones.
- **Jobs are identified by a unique key**, not by job name alone.
- **Admin views stay simple to interpret.** Crew field UX stays simple and fast. App is primarily mobile.

## Render Start Command (BOTH staging and prod)

Both Render services must use this start command. Migrations run in their
own short-lived process before uvicorn launches (so the web worker doesn't
carry the alembic + migration-module import surface during boot, that
was OOM-killing the 512 MB worker once the migration chain grew past ~24
modules). The `--limit-max-requests` and `--limit-concurrency` flags are
**load-bearing**, they recycle the worker periodically (caps any slow
leak, unbounded module-level state, library caches, etc.) and bound
the number of in-flight requests (so concurrent uploads can't stack into
RAM).

```
python scripts/run_migrations.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT --limit-max-requests 1000 --limit-concurrency 50 --timeout-keep-alive 5
```

If you change either flag, document the reason here. Removing them
reintroduces the recurring OOM class we spent multiple deploys chasing.

Render's Root Directory is set to `backend` for both services, so the
working directory at start time is already `backend/`. Don't prefix the
script path with `backend/`, that produces a duplicated segment and the
script can't be found.

The app also installs `BodySizeLimitMiddleware` (`app/core/limits.py`)
which rejects any request whose body exceeds 100 MB with `413 Payload
Too Large`. Bump `MAX_REQUEST_BODY_BYTES` only if a new endpoint genuinely
needs a higher cap, and add a per-route override there rather than
raising the global limit, so one heavy endpoint doesn't widen the OOM
surface for everything else.

The on_startup hook in `app/main.py` no longer runs alembic. If schema is
stale at boot, the first DB query that needs a missing column surfaces a
clear ProgrammingError, easier to diagnose than an OOM kill.

For local development from the repo root:
`python backend/scripts/run_migrations.py` once after pulling new
migrations, then `cd backend && uvicorn app.main:app --reload`. The
`--limit-*` flags aren't needed locally, they're a production hygiene
measure, not a correctness requirement.

## Staging → main promotion workflow

Only run when explicitly asked to promote.

1. **Merge** `staging` into `main`. Render auto-deploys main on push.
2. **Verify the start command above is set** on the Render prod service before promoting (only needed once; persists across deploys). Migrations now run as part of the start command, not at app startup.
3. **Run the user-migration script:** `backend/scripts/migrate_users_staging_to_prod.py`. It copies `email`, `password_hash`, `name`, `role`, `is_active`, `profile_photo`, `is_skill_rater` from staging Postgres to prod Postgres with `ON CONFLICT (email) DO NOTHING` (prod wins on conflicts). Crew who only exist on staging would otherwise have to re-register. Dry-run first:
   ```
   STAGING_DATABASE_URL=... PROD_DATABASE_URL=... \
     python backend/scripts/migrate_users_staging_to_prod.py --dry-run
   ```
4. **Verify prod env vars** (see checklist below). Missing/stale values here have caused a crew member to be unable to reset their password post-promotion.
5. **Vet `docs/DATA_FLOW.md` against what is being pushed** and bump its "Verified against" block. See the Data-flow doc gate in [docs/VETTING_PROTOCOL.md](docs/VETTING_PROTOCOL.md). A stale data-flow doc is a promotion blocker.

**One-time, on the promotion that carries [ADR 0014](docs/decisions/0014-skill-rating-is-designated-not-inherited.md):** the `crew_lead` role stops granting skill rating. Every prod crew lead who should keep rating needs the **Skill rater** toggle set on them in Admin → roster. Do this in the same sitting as the promotion, or leads will quietly find the skill rows and the job-type picker gone the next morning. `ON CONFLICT DO NOTHING` means the migration script will not fix it for anyone who already exists in prod.

### Post-promotion env-var checklist

Verify these on the prod deploys before declaring a promotion done:

- **Render prod backend**
  - `FRONTEND_URL` → prod Vercel hostname. `backend/app/routers/auth.py` reads it to build the password-reset link; a stale value sends crew to the wrong frontend and they hit "Invalid or expired reset link" because the token is in the other DB.
  - `JWT_SECRET` → set. Code fails-closed when `DATABASE_URL` is set but `JWT_SECRET` is missing, the app won't boot.
  - `DATABASE_URL` → prod Postgres.
  - Postmark token → prod sender/token, not staging's.
- **Vercel prod frontend**
  - `VITE_API_URL` → prod backend origin, not staging.

If a crew member reports reset or login issues right after a promotion, check these before digging into code. `grep` Render logs for `[forgot-password]`, that line prints the generated reset link and exposes a wrong hostname instantly.

### Password-drift gotcha

The user-migration script is `ON CONFLICT DO NOTHING`, so a crew member who exists in both DBs keeps their **prod** `password_hash`. If they changed their password on staging during testing, that change does not carry over, they sign in on prod with their old prod password, or reset.

## Repo layout

- `backend/app/routers/`, FastAPI routers (`auth`, `users`, `dvir`, `materials`, `estimates`, `job_report`, `bill`, `long_distance`, `documents`, `patch_notes`, `admin_notes`, `admin`, `config`).
- `backend/app/db/models/`, SQLAlchemy models.
- `backend/alembic/versions/`, migrations.
- `backend/app/integrations/sheets_export.py`, Google Sheets writes.
- `backend/app/integrations/drive_upload.py`, Drive uploads (estimator photos have their own folder).
- `backend/scripts/migrate_users_staging_to_prod.py`, one-shot user migration, idempotent.
- `apps_script/`, Google Apps Script bound to the Sheet. **A fourth runtime that CI does not deploy**: the files here are the source of truth, but what runs is whatever has been pasted into the Sheet's script editor. `nightly_crew_email.gs` is the ~9 PM crew-feedback + incidents email. A change here is not shipped until somebody pastes it in.
- `frontend/src/pages/`, route-level screens.
- `frontend/src/components/`, shared UI.
- `frontend/src/lib/`, client-side stores and offline queues (`materialsStore`, `estimatorQueue`, etc.).
- `frontend/src/auth/AuthContext.tsx`, frontend auth state.

## Security notes

- `POST /api/users` is admin-gated. Self-service signup is `POST /api/auth/signup` (pending-approval).
- `PATCH /api/dvir/{id}/mechanic-sign` is admin-gated, the mechanic-review UI only renders for admins handing the device off.
- **Skill ratings** are gated on `role == "admin" or users.is_skill_rater`, a per-person flag an admin sets from the roster. The `crew_lead` role does **not** grant it, see [ADR 0014](docs/decisions/0014-skill-rating-is-designated-not-inherited.md). Enforced server-side in `job_report.py::_is_skill_rater`: a non-rater's report save preserves the ratings a rater already set (even against an empty payload) and drops whatever its own payload carries, so hiding the UI is not the only thing standing in the way. **Job type is NOT gated** - it is the job's descriptive data and must be collected whether or not a rater is on site (ADR 0014, reversed 2026-07-14).
