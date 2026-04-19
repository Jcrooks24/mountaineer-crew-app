# mountaineer-crew-app

Crew-facing app used in the field on mobile. `backend/` is FastAPI + Postgres + Alembic; `frontend/` is Vite/React. Backend deploys on Render, frontend on Vercel. Synced data lands in a shared Google Sheet.

## Branch rule

**All pushes go to `staging`. Never push to `main` unless explicitly instructed to promote.**

`main` is production. `staging` is for testing and debugging new features before they reach crew devices. Default target for commits and PRs is `staging`.

## Core invariants (must be preserved on any change)

- **Offline-first.** The app must work offline without data loss and sync when back online.
- **Synced data lands in the Google Sheet** (ID `1KDWNudFSc8tlqV7lzq-M235swkgq7jWg_63ilrw_9hk`). Staging writes to `*Staging`-suffixed worksheets (`EventsStaging`, `MaterialsStaging`, etc.); production writes to the unsuffixed ones. The split is controlled by env vars — do not hardcode worksheet names.
- **Crew auth:** login, logout, and password reset must keep working end-to-end.
- **Field-grade reliability.** Quality is priority #1 — prefer boring, well-tested paths over clever ones.
- **Jobs are identified by a unique key**, not by job name alone.
- **Admin views stay simple to interpret.** Crew field UX stays simple and fast. App is primarily mobile.

## Staging → main promotion workflow

Only run when explicitly asked to promote.

1. **Merge** `staging` into `main`.
2. **Run alembic migrations** on the prod backend.
3. **Run the user-migration script:** `backend/scripts/migrate_users_staging_to_prod.py`. It copies `email`, `password_hash`, `name`, `role`, `is_active`, `profile_photo` from staging Postgres to prod Postgres with `ON CONFLICT (email) DO NOTHING` (prod wins on conflicts). Crew who only exist on staging would otherwise have to re-register. Dry-run first:
   ```
   STAGING_DATABASE_URL=... PROD_DATABASE_URL=... \
     python backend/scripts/migrate_users_staging_to_prod.py --dry-run
   ```
4. **Verify prod env vars** (see checklist below). Missing/stale values here have caused a crew member to be unable to reset their password post-promotion.

### Post-promotion env-var checklist

Verify these on the prod deploys before declaring a promotion done:

- **Render prod backend**
  - `FRONTEND_URL` → prod Vercel hostname. `backend/app/routers/auth.py` reads it to build the password-reset link; a stale value sends crew to the wrong frontend and they hit "Invalid or expired reset link" because the token is in the other DB.
  - `JWT_SECRET` → set. Code fails-closed when `DATABASE_URL` is set but `JWT_SECRET` is missing — the app won't boot.
  - `DATABASE_URL` → prod Postgres.
  - Postmark token → prod sender/token, not staging's.
- **Vercel prod frontend**
  - `VITE_API_URL` → prod backend origin, not staging.

If a crew member reports reset or login issues right after a promotion, check these before digging into code. `grep` Render logs for `[forgot-password]` — that line prints the generated reset link and exposes a wrong hostname instantly.

### Password-drift gotcha

The user-migration script is `ON CONFLICT DO NOTHING`, so a crew member who exists in both DBs keeps their **prod** `password_hash`. If they changed their password on staging during testing, that change does not carry over — they sign in on prod with their old prod password, or reset.

## Repo layout

- `backend/app/routers/` — FastAPI routers (`auth`, `users`, `dvir`, `materials`, `estimates`, `job_report`, `bill`, `long_distance`, `documents`, `patch_notes`, `admin_notes`, `admin`, `config`).
- `backend/app/db/models/` — SQLAlchemy models.
- `backend/alembic/versions/` — migrations.
- `backend/app/integrations/sheets_export.py` — Google Sheets writes.
- `backend/app/integrations/drive_upload.py` — Drive uploads (estimator photos have their own folder).
- `backend/scripts/migrate_users_staging_to_prod.py` — one-shot user migration, idempotent.
- `frontend/src/pages/` — route-level screens.
- `frontend/src/components/` — shared UI.
- `frontend/src/lib/` — client-side stores and offline queues (`materialsStore`, `estimatorQueue`, etc.).
- `frontend/src/auth/AuthContext.tsx` — frontend auth state.

## Security notes

- `POST /api/users` is admin-gated. Self-service signup is `POST /api/auth/signup` (pending-approval).
- `PATCH /api/dvir/{id}/mechanic-sign` is admin-gated — the mechanic-review UI only renders for admins handing the device off.
