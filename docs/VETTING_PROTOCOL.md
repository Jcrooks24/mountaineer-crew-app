# Mountaineer Crew App - Debugging & Vetting Protocol

Reusable protocol for debugging and pre-promotion vetting. Hand it to an agent
(or run `/vet`) to check the app against its core behaviors before a
`staging -> main` promotion. Built around the project's actual architecture.

## How to run this

You are vetting the Crew App (frontend: `frontend/` Vite + React + TS PWA;
backend: `backend/` FastAPI + SQLAlchemy + Alembic, SQLite in dev / Supabase
Postgres in prod on Render; synced data lands in a shared Google Sheet; photos
+ signed PDFs land in Google Drive). Vet either the current git diff or a named
surface (e.g. "long-distance mode", "BOL flow", "the timeline").

Rules:
- **Evidence first, never assume.** Confirm each claim by reading the file,
  building, or hitting the API. Cite the file:line, command, or response you
  used. Do not assert from memory - the codebase moves fast.
- Report findings as a table: `# | Severity (Critical/High/Med/Low) | Behavior # | Issue | Evidence | Fix`.
- Separate **Passed (verified)** from **Findings**. Don't pad; a clean check is a result.
- Distinguish promotion blockers (Critical/High) from follow-ups (Med/Low).
- Offer to fix; apply only small, safe, high-confidence fixes unless told otherwise.
- **Staging only.** All changes go to `staging`, never `main`, unless the user
  says "promote" (see `CLAUDE.md`). Confirm `git branch --show-current` is `staging`.

## Standard evidence toolkit

- **Frontend build (must be clean):** `cd frontend && npm run build` (runs
  `tsc -b && vite build`). Zero TypeScript errors. The one expected warning is
  the >500 kB chunk size notice - not a defect.
- **Backend compiles/imports:** `cd backend && python -m py_compile <changed files>`.
  For a real import/endpoint check the project venvs on this machine are broken
  (Python 3.14 vs 3.11 wheels); use a disposable venv instead:
  `python -m venv <scratch>/venv && <scratch>/venv/Scripts/pip install pydantic sqlalchemy fastapi email-validator python-multipart tzdata`,
  then run isolated unit tests that stub `app.integrations.sheets_export`,
  `app.integrations.drive_upload`, and `app.core.deps` (see the scratch tests
  used for BOL / RODS / LD-day) and drive the router functions directly against
  a SQLite `Base.metadata.create_all` schema.
- **Alembic single head:** `python -c "from alembic.config import Config; from alembic.script import ScriptDirectory; print(ScriptDirectory.from_config(Config('alembic.ini')).get_heads())"`
  must print exactly one head. New schema needs a migration (never rely on
  `create_all` for prod - Render runs `scripts/run_migrations.py` before uvicorn).
  Migrations must be Postgres-compatible (SQLite can't run some, e.g. the
  `ALTER COLUMN ... TYPE` in `materials_total_numeric` - that's expected).
- **Debug artifacts:** grep changed frontend files for `console.log|debugger`;
  grep changed backend files for `breakpoint(`. NOTE: the backend uses tagged
  `print("[bol] ...")` / `[drive]` / `[rods]` lines as intentional operational
  logging - those are fine; only flag stray/accidental debug prints.
- **Idempotency replay:** call a retryable mutation twice with the same device
  UUID (`event_id`, `submission_id`, `bol_id`, `rods_id` per-day, `day_id`);
  expect one row and the existing record back, never a duplicate or a 500.
- **Env split:** staging writes to `*Staging` worksheets via `SHEETS_*_TAB` env
  vars; a missing var silently writes to the prod tab. List any new tab/folder
  env var the change introduces.

---

## Core Behavior 1 - Offline-first, no data loss

**Invariant:** the app works with no signal and loses nothing; writes queue
locally and drain on reconnect; persisted state survives reload; retries never
duplicate.

- Every field write is queued locally first (localStorage/IndexedDB) then synced:
  events (`crew_event_queue_v1`), materials (`materialsStore`), BOL (`bolStore`),
  RODS (`rodsStore`), per-diem (`ldDayStore`), photos (`photoStore` IndexedDB),
  reimbursements (`reimbursementStore`). A new write path MUST follow this shape.
- Sync drains in order; transient failures (offline / 5xx / 408 / 401 / 403)
  stay queued; only permanent 4xx are dropped (poison-pill) with a `console.warn`.
- Drafts autosave before submit (BOL draft, RODS day, report draft) so nothing
  is lost if the app is backgrounded mid-entry.
- **Failure modes:** a mutation that hits the API without enqueuing (lost when
  offline); a queue that drops 401/403 (loses a crew member's queued work when a
  token briefly expires); an autosave that only holds in memory; a sync that
  clears the queue before the POST confirms.
- **Verify:** DevTools offline -> perform the action -> reload (state persists)
  -> go online -> confirm it syncs with no dupes. Grep the changed store's
  `syncQueue` for the permanent-vs-transient split.

## Core Behavior 2 - Cross-device continuity

**Invariant:** once a device syncs, a second device (or a different crew member)
opening the same job/entity hydrates the SERVER state and can continue it - the
UI does not read local storage only.

- Job-scoped entities are keyed by a shared `job_uuid` (calendar events resolve
  the same way on every device via `resolveJobUuid` / `calEventToJobUuid`), so
  the same job aligns across devices.
- On mount, the UI fetches/adopts the server copy: events
  (`loadHistoryFromBackend` + `fetchJobEvents`), materials (`fetchAndCache`),
  photos (`fetchServerPhotos`), BOL (`loadForJob` adopts the server BOL), RODS
  (`loadOrResumeDay` adopts a server day that is ahead), per-diem
  (`ldDayStore.hydrateDay`), report/bill (GET on mount).
- Adoption must not clobber unsynced local work: skip when the local record has
  queued ops, or when local is genuinely newer.
- **Failure modes:** a store that only reads local storage on mount (a second
  device sees nothing); adopting server state over unsynced local edits; a
  device-random id where a deterministic/shared key is needed (breaks the join).
- **Verify:** do the action on device A (let it sync); open the same job on
  device B and confirm the state is there and continuable.

## Core Behavior 3 - Everything lands in Google Sheets (admin's source of truth)

**Invariant:** every synced record reaches the shared Sheet; staging and prod
write to distinct worksheets; re-submits don't accumulate rows.

- Each sync endpoint fires `run_export_in_background(export_*_to_sheets, ...)`.
  A new synced entity MUST export.
- Worksheet names come from `SHEETS_*_TAB` env (`Events`/`EventsStaging`, etc.),
  never hardcoded - the staging/prod split depends on it (`CLAUDE.md` invariant).
- Upserted entities use a **replace-style** export (delete rows by key, then
  write) so an edit rewrites its row instead of appending: estimates, BOL, RODS,
  LD-day. Append-once entities dedupe via `sheet_generic_exports (kind, key)`.
- **Failure modes:** a new synced record that never exports (admin can't see it);
  a hardcoded tab name (staging data bleeds into the prod sheet); an upsert that
  appends instead of replacing (duplicate rows per entity); an export that runs
  on every autosave keystroke (Sheets API spam - unsigned RODS is DB-only by design).
- **Verify:** trigger the write, confirm one row in the `*Staging` tab; re-submit
  and confirm still one row.

## Core Behavior 4 - Crew auth stays intact

**Invariant:** login, logout, and password reset work end-to-end; protected
routes require a valid JWT; admin-only routes enforce the role server-side.

- Every API call carries the bearer token (`apiFetch` / `makeAuthHeaders`); a
  401 clears the token. Public routes (`/login`, `/reset-password`,
  `/mechanic-sign`) are the only unauthenticated ones.
- Admin endpoints depend on `require_admin` (server-side role check), not just a
  hidden client button. Password-reset links are built from `FRONTEND_URL`.
- Switching users on a shared device wipes per-user local state
  (`clearCrewState` clears `crew_*`/`mm_*` + `crew_app_db`) so crew B never
  inherits crew A's queued work.
- **Failure modes:** a new admin action gated only in the UI; a fetch that skips
  the auth header; a new per-user local key not covered by the `crew_`/`mm_`
  prefix (leaks across users on a shared phone); a 401 that doesn't clear state.
- **Verify:** hit a new admin endpoint as a non-admin (expect 403); log out and
  confirm queues/drafts are cleared; confirm reset email link host is correct.

## Core Behavior 5 - Jobs identified by a unique key, not a name

**Invariant:** all job data is keyed by `job_uuid` (a device-stable, cross-device
identical id), never by job name alone.

- Calendar jobs derive the same `job_uuid` on every device (server
  `/api/jobs/resolve`, falling back to the deterministic `calEventToJobUuid`
  hash). Manual jobs mint a UUID. `job_name` is a human label only.
- Records store `job_uuid` (+ `job_name` for readability); joins/filters use the
  uuid.
- **Failure modes:** filtering or de-duping by `job_name`; a new feature that
  mints a fresh random job id instead of reusing the selected job's uuid
  (breaks correlation across Events/Materials/BOL/RODS for the same job).
- **Verify:** two devices selecting the same calendar job produce the same
  `job_uuid`; the record joins to that job's other data.

## Core Behavior 6 - Field-grade reliability & simple mobile UX

**Invariant:** the app is fast and legible on a phone in the field; errors
surface clearly; admin can interpret the data at a glance.

- Touch targets are adequate; no horizontal overflow; inputs don't trigger iOS
  zoom (font-size >= 16px on inputs where relevant). Uses theme CSS vars
  (`var(--brand)`, `var(--muted)`, ...), not hardcoded colors, so themes hold.
- Network/API/sync errors show a clear message (toast / inline / status chip),
  never a silent no-op on a user action.
- Beta features carry the `beta` subtext via `<BetaTag feature="..." />` until
  the next `APP_VERSION` bump (`lib/betaFeatures.ts`).
- Admin reads the Sheet: one clean row per entity, human-readable columns.
- **Failure modes:** a hardcoded color that breaks on an alternate theme; a
  `catch {}` that swallows a user-initiated failure; a table that overflows on a
  narrow screen; a new feature missing its `beta` tag.
- **Verify:** view the changed screen at phone width; force an API error and
  confirm a visible message; grep changed files for hardcoded hex colors and
  empty catches.

---

## Cross-cutting (always check)

- **Env vars:** any new `SHEETS_*_TAB` / `DRIVE_*` / secret is listed for the
  user to set on staging (and prod at promotion), pointing at the right target
  (staging DB/Sheet tabs/Drive folder, not prod).
- **Migrations:** schema change has an Alembic migration chained onto the single
  head; Postgres-compatible; forward-only where a down-migration can't restore
  NOT NULL cleanly (say so).
- **Resource usage (OOM history - `CLAUDE.md`):** the Sheets export
  `ThreadPoolExecutor` stays bounded (max_workers=2); no unbounded thread/memory
  growth; no polling loop left running; the uvicorn `--limit-max-requests` /
  `--limit-concurrency` flags stay in the Render start command.
- **Security:** admin routes role-checked server-side; no PII/secrets in
  client-side storage or logs; `.env` / `token.json` / `credentials.json` /
  `*.db` never committed.
- **Build health:** `tsc` + `vite build` clean; backend `py_compile` clean; no
  debug artifacts or dead imports in changed files.
- **Regression:** surfaces untouched by the change (DVIR, materials, photos,
  reimbursements, estimator, job report + bill, availability, BOL, RODS) still
  work end-to-end.

---

## Code-level reliability (run on changed files)

Catches the failure modes that slip past the behavior checks. Cite evidence
(file:line / a replay / a grep) the same way; a clean check is a result.

### Idempotency & retry safety
- Retryable mutations dedupe on a client-minted key: unique index or an
  existence check, so an offline-queue replay or a lost-response retry returns
  the existing record, never a second row or a 500. Keys in use: `event_id`,
  `submission_id` (materials), `bol_id` (BOL upsert), `(driver_id, log_date)`
  (RODS), `(driver_id, date)` (LD-day), `reimbursement_uuid`.
- Concurrent same-key insert is caught (`IntegrityError` -> return existing).
- Update/delete confirm the target first (query -> 404 on missing); no silent
  no-op or wrong-row hit.

### Async & concurrency
- Sheets/Drive exports run off-request via `run_export_in_background` (bounded
  pool) so a slow Google call never blocks or fails the API response.
- Thread-local Sheets service (`_get_sheets_svc`) - do not share one httplib2
  socket across threads (SSL corruption). httplib2 is not thread-safe.
- React effects that `setState` after an `await` use a cancelled/`alive` flag and
  don't read stale captured state; `online` / `addEventListener` have matching
  cleanup.

### Server-side validation (never trust the client)
- `created_by` / `driver_id` / submitter come from the authenticated user
  server-side, not client input; enumerated fields (status, phase, billing
  method) are validated on the server on both create and update paths.

### Scale inflection points
- No N+1: reference sets loaded once before a loop, not per-row (bill seed,
  sheets exports). Grep changed routers for a query/`await` inside a `for`/`while`.
- List endpoints are bounded (`.limit(...)`); unfiltered list endpoints return a
  light projection where the full record is heavy (e.g. `GET /api/bol` strips
  signature blobs when unfiltered).
- Long-term row growth (events/materials/estimates) doesn't degrade a hot query -
  filter columns that back a scan are indexed.

### Null / empty handling
- Optional fields use nullish guards (`?.`, `?? default`), not falsy collapses;
  `.map`/`.reduce`/`.filter` and DB result lists handle the empty case; parse of
  `items_json` / `duty_changes_json` is wrapped in try/except.

### Cleanup & teardown
- `addEventListener` / `setTimeout` / `setInterval` in components have matching
  cleanup in the effect return; app-lifetime listeners are noted as intentional.

### Added evidence checks
- **Idempotency replay:** call a retryable mutation twice with the same key;
  expect one row and the existing record.
- **N+1 scan:** grep changed routers for a query/`await` inside a loop body.
- **Teardown scan:** grep changed components for `addEventListener`/`setTimeout`/
  `setInterval` and confirm a matching cleanup.
- **Cross-device scan:** for a changed store, confirm a server-hydrate path runs
  on mount (Behavior 2), not local-only reads.
