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
- **If the change touches a one-copy, irreplaceable data path** (a signed
  document, a photo, a receipt), the happy-path checks below are not enough - also
  run the **Durability vet for irreplaceable data** at the end of this doc. It
  injects failure at the seams (server error, worker death, logout mid-sync,
  staging-vs-prod) that normal testing never reaches, and is where the BOL
  data-loss batch would have been caught.
- **Staging only.** All changes go to `staging`, never `main`, unless the user
  says "promote" (see `CLAUDE.md`). Confirm `git branch --show-current` is `staging`.
- **On a promotion vet, `docs/DATA_FLOW.md` is a gate.** See "Data-flow doc gate"
  below. A promotion is not vetted until that doc matches what is being pushed.

## Data-flow doc gate

The field-level ledger of what triggers each data exchange and when the transfer
happens lives in two files:

- **[DATA_FLOW.md](DATA_FLOW.md)** covers production, verified against `main`. It
  changes only at promotion.
- **[DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md)** is the delta: everything
  `staging` adds or changes on top of that. It changes with every feature.

### On every staging commit (not just promotions)

If the change touches a queue key, a drain function or its trigger, a debounce
timing, an endpoint, a Sheet export function, a tab env var, a write strategy, or
reconciler coverage, then **DATA_FLOW_STAGING.md is updated in the same commit**,
with the domain's per-field table. Adding a field to a payload without adding it
there is exactly how the doc goes stale. A `/vet` on a diff that changed a data path
and left the staging doc untouched is a finding.

### On a `staging -> main` promotion

1. **Diff the surface.** For everything in the promotion, list what changed in:
   queue keys, drain functions and their triggers, debounce timings, endpoints,
   Sheet export functions, tab env vars, write strategy (append vs replace), and
   reconciler coverage. Check it against what DATA_FLOW_STAGING.md claims; a gap
   means somebody skipped the same-commit rule and the doc is under-reporting.
2. **Reconcile the field tables.** Every new or changed payload field appears in
   the right domain table with an accurate `[x]` / `[ ]` / `[-]` mark. A field
   marked `[x]` means you traced it device to Postgres to Sheet, not that you
   assumed it.
3. **Fold the delta up.** Merge each DATA_FLOW_STAGING.md section into the matching
   place in DATA_FLOW.md: new domains become new sections, changed rows are edited
   in place, new deviations join the Deviations list.
4. **Empty DATA_FLOW_STAGING.md** back to its skeleton and reset its "Verified
   against" to the new `main`. Anything deliberately not folded up stays, with a
   written reason. An entry left there without one is a lie about what is unreleased.
5. **Re-check the Deviations list.** Anything fixed comes out; anything newly
   found goes in and also into Known defects in [RUNBOOKS.md](RUNBOOKS.md).
6. **Bump DATA_FLOW.md's "Verified against" block** to the commit being promoted,
   with the date and whether it was verified by reading or by exercising the app.

### Blocking conditions

A new staging data flow that does not pass **blocks the merge**. It is not a
follow-up and it does not ride along to be fixed later. Report each as Critical or
High in the findings table, never Med/Low.

A flow passes when every field in its table is `[x]` or `[-]` and it does what its
flow class promises. These stop a promotion:

1. **Any `[ ]` in DATA_FLOW_STAGING.md.** A field that does not complete its path is
   data the app collects and then loses. Promoting it puts that loss in front of
   crews.
2. **Any entry under "Deviations new on staging".** A new path that does not honor
   its class's contract, most often ADR 0013's never-delete-queued-work rule.
3. **A data path changed in the promotion diff but absent from the staging doc.**
   You cannot vet what was never logged. Treat it as failing until it is written up,
   then vet it on its merits.

**Inherited deviations do not block.** Anything `main` already carries and
[RUNBOOKS.md](RUNBOOKS.md) already lists under Known defects is pre-existing;
promoting it changes nothing about production. Only deviations **introduced on
staging** stop a merge. Do not let a long-standing known defect hold a promotion
hostage, and do not let a new one through because the list looks similar.

**Clearing a blocker** takes one of two things: fix it, or an explicit written waiver
from the user recorded in DATA_FLOW_STAGING.md with the reason. An agent cannot waive
its own finding, and silence is not a waiver. A stale or under-reported doc is itself
a blocker, because the whole point is that a successor can trust it without
re-deriving it.

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
- **Earned-success grep (unconditional - run on EVERY diff):** the cheap half of
  the durability vet, run always because a lying success is silent and catastrophic
  and the grep is free. Two sweeps:
  ```
  # A write endpoint that signals failure in the BODY but returns HTTP 200.
  # apiFetch throws only on !res.ok, so a 200-with-ok:false is read as success
  # and the queued op is DROPPED. Each hit must be a real raise HTTPException.
  grep -rn '"ok": *[Ff]alse\|return.*ok=False' backend/app/routers

  # A swallowed write on the client. An empty catch or a swallowed quota error on
  # a localStorage/IndexedDB write reports success while dropping the data.
  grep -rn 'catch *{ *}\|catch (_*e*) *{ *}' frontend/src/lib frontend/src/auth
  ```
  A backend hit is a finding unless the endpoint ALSO returns a non-2xx status
  (5xx for a DB/upstream failure = retryable; 4xx for a bad payload = surfaced).
  A frontend hit is a finding if the swallowed path is a WRITE (a read/best-effort
  swallow is fine - say which it is). See the Durability vet at the end of this
  doc for the full failure-seam pass when the change touches irreplaceable data.
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
  stay queued. A permanent 4xx is **marked failed and kept**, never deleted, and
  is shown to the crew member with a reason and a Retry
  ([ADR 0013](decisions/0013-rejected-queue-work-is-never-deleted.md)). A queue
  that deletes rejected work is a finding, including a brand-new queue: the rule
  binds the one you are writing now, not just the ones already on the list.
- Drafts autosave before submit (BOL draft, RODS day, report draft) so nothing
  is lost if the app is backgrounded mid-entry.
- **Failure modes:** a mutation that hits the API without enqueuing (lost when
  offline); a queue that drops 401/403 (loses a crew member's queued work when a
  token briefly expires); an autosave that only holds in memory; a sync that
  clears the queue before the POST confirms.
- **Verify:** DevTools offline -> perform the action -> reload (state persists)
  -> go online -> confirm it syncs with no dupes. Grep the changed store's
  `syncQueue` for the permanent-vs-transient split.

### Behavior 1a - Queued work is SELF-CONTAINED (no live handles)

**Invariant:** a queued payload is plain data. Every field is a **value** - string,
number, boolean, `ArrayBuffer` - never a **handle** to something that lives outside
the queue: `File`, `Blob`, `URL`, a DOM node, a stream, an object URL.

This is its own check because the rest of Behavior 1 cannot see it. "The queue
survives a reload" and "the queued payload is still USABLE after a reload" are
different claims, and we shipped a bug that satisfied the first and failed the
second.

A `File` off an `<input>` is a *reference to a file on disk*, not the image. Persist
it, reload, come back two days later, and the reference can be dead. **A dead
reference does not throw.** Appending it to `FormData` produces a request whose body
never serialises: the server gets an empty body, every form field looks absent, and
the API complains about the one field that has no default. The error then names a
field the client provably sends, on the first line of the form, unconditionally. See
[ADR 0017](decisions/0017-offline-queues-store-bytes-not-file-handles.md).

- **The check (10 seconds, deterministic, needs no device):** for every type that is
  written to IndexedDB / localStorage / any queue that drains later, read its field
  list. Any `Blob`, `File`, or `URL` in it is a **finding**.

  ```
  grep -rn ": *Blob\|: *File\|Blob | null\|File | null" frontend/src/lib
  ```

  The grep surfaces **candidates**, not findings. A `Blob` as a *function parameter*
  or a local is fine - it is transient and dies with the call. It is a finding only
  when the field belongs to a type that gets **persisted**. Run it against the
  pre-fix tree and it prints exactly the four fields that were the bug
  (`reimbursementStore`'s three `_blob` fields and `photoStore.blob`), which is the
  standard to hold it to.

  Images go in as bytes via `lib/queuedPhoto.ts` (`toQueuedPhoto` on the way in,
  `slotToBlob` on the way out). Do not hand-roll a second copy of that.

- **The upload path must materialise the bytes BEFORE building the request**, so an
  unrecoverable payload throws where we can tell the crew member, instead of
  silently posting an empty body.

- **A round-trip unit test does NOT catch this, and will tell you it is fine.**
  Write the entry, read it back, assert - it passes, because in a test environment
  the handle is never dead. It is worse than no test: it is false comfort. The
  static rule above is the check; the test is not.

- **DevTools offline on desktop does NOT catch this either.** Chrome keeps blobs
  alive. This is a WebKit/iOS failure and the crew are on phones. Any verification
  of a binary payload that runs only on a desktop browser proves nothing about the
  device the bug happens on.

- **The test for a NEW feature:** does a `File` or `Blob` outlive the event handler
  that produced it? If yes, it must be bytes.

### Triage rule: when the server rejects a field the client provably sends

If an API reports a required field missing, and you can read the client code and see
it being sent unconditionally, **stop looking at the field.** Look at the body.

"A required form field is missing" has two very different causes, and the field name
alone cannot tell them apart: the client genuinely omitted it, **or the body never
parsed** - empty body, dead blob, multipart with no boundary - and so *every* field
looks missing while only the one without a default is reported.

The `content-length` on the failing request is what separates them, which is why the
422 handler in `app/main.py` logs `content-type` and `content-length` and must keep
doing so. A payload with a photo attached and a content-length of a few hundred bytes
is the whole diagnosis.

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
- **Health check (run every vet):** open Admin → Advanced Settings → **System
  Check, Sheet Syncs** (or `GET /api/admin/system-check/sheets`) and confirm
  Sheets is connected and every sync's tab exists. **If the change adds a new
  sheet sync, its entry MUST be added to `SHEET_SYNC_REGISTRY` in
  `backend/app/integrations/sheets_export.py`** so the health check covers it -
  a new sync missing from the registry is a finding. The check also flags syncs
  whose `SHEETS_*_TAB` env var is unset (using the default tab - on staging that
  silently targets the prod worksheet) and any sync with a recent export error.
- **Data integrity (run before every promotion):** run
  `backend/scripts/sheet_integrity_check.py` against prod and confirm **zero
  FAILs** - duplicate keys, an overwritten KEY column, or junk tabs. It re-derives
  each tab from the code's own `*_HEADERS`, so a column this change adds is covered
  automatically; WARNs about not-yet-promoted columns are expected pre-promotion.
  This is the "is the data clean" companion to the "is the sync working" health
  check above.

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
- **Docs still true (bus-factor):** the change did not silently invalidate the
  docs a successor depends on. Cheapest way to check is to run `/handoff`, but
  the four that matter here:
  - every new env var / secret / Google API is in `docs/CREDENTIALS.md`
    (names only, never values);
  - `docs/ARCHITECTURE.md` and its diagram still match if a service, queue,
    integration, or data flow moved;
  - a decision someone would be tempted to undo has an ADR in
    `docs/decisions/`;
  - any bug found and **not** fixed is in Known defects in `docs/RUNBOOKS.md`,
    and any listed bug that got fixed is deleted from it.

  A promotion that leaves an undocumented env var behind is a promotion that
  breaks for whoever deploys next. Treat a missing credential entry as a
  blocker, not a follow-up.

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

---

## Durability vet for irreplaceable data (the failure-seam pass)

**Run this whenever a change touches a one-copy, irreplaceable data path** - a
signed legal document (BOL, DVIR), a photo or receipt, anything with no second
copy if this one is lost. It is a DIFFERENT axis from every check above. The rest
of this protocol tests "does the happy path work and survive reload / offline."
This class of bug does not fail on that axis: in a test environment the server
does not error, the worker is not recycled mid-task, nobody logs out during a
sync, and staging and prod look identical. The bugs live at the FAILURE SEAMS,
and the only way to catch them is to inject failure there on purpose.

This pass exists because a batch of them shipped anyway - a signed BOL that
reached neither the sheet nor Drive (see [ADR 0020](decisions/0020-bol-durability-and-honest-failures.md)
/ [ADR 0021](decisions/0021-preserve-pending-bol-work-on-logout.md)). Each check
below is named with the failure it would have caught.

**The rule that unifies it:** for irreplaceable data, every success the UI
reports must be EARNED, and every failure must be surfaced or retried, never
swallowed.

**Triage first (scopes the whole pass).** Classify each data path the change
touches by "what happens if this is lost." One-copy / irreplaceable = every audit
below is mandatory. A cache or a re-derivable value = skip it. This tells you
where to spend the failure-injection budget.

### 1. Earned-success audit (a success signal must be backed by a durable fact)

Trace every "Saved" / "Synced" / "Complete" the UI shows back to what guarantees
it. A success is legitimate only when the server returned a real 2xx AND the
local write actually persisted.

- **Grep the server for a lying 200.** Any write endpoint that returns
  `{"ok": false}` (or an error body) without ALSO returning a non-2xx status is a
  lie the client reads as success. `apiFetch` throws only on `!res.ok`, so a
  200-with-`ok:false` is acked and the queued op is DROPPED.
  ```
  grep -rn '"ok": *[Ff]alse\|ok=False' backend/app/routers
  ```
  Every hit on a write path must be a real `raise HTTPException(5xx/4xx)` instead.
  A DB error is a 5xx (retryable); an upstream (Drive) failure is a 502
  (retryable); a bad payload is a 4xx (permanent, surfaced). *Caught bug 1.*
- **Grep for swallowed writes.** An empty `catch {}` or a swallowed
  `QuotaExceededError` on a write path is a silent drop behind a success message.
  ```
  grep -rn 'catch {}\|catch (_*) {}' frontend/src/lib frontend/src/auth
  ```
  A localStorage/IndexedDB write on a critical path must return success/failure
  and the caller must surface a failure, not report "saved". *Caught bug 5.*
- **Follow each success toast to its gate.** Is it gated on the drain's RESULT,
  or optimistic? Is the failed-op banner refreshed after the write, or only on
  remount? *Caught bug 6.*

### 2. Kill-test (crash between the DB commit and the external write)

For any write with a "Postgres first, external system (Sheets / Drive) second"
shape, reason through `kill -9` after each line between the DB commit and the
external write. The kill is not hypothetical: Render recycles the worker every
`--limit-max-requests` (1000) and has OOM history, so "the worker dies mid-task"
is guaranteed to happen.

- **If the process dies before the external write runs, what recovers it?** If
  the answer is "nothing," a reconciler is required. The events and BOL
  reconcilers (`sheets_reconcile.py` / `bol_reconcile.py`) are the pattern: find
  rows in Postgres with no export record and re-ship them, idempotently, from the
  advisory-locked auto-reconciler, surfaced as a "Sheet drift" health check.
  A new synced entity on a background pool needs its own reconciler entry, or it
  is one worker recycle away from permanent loss. *Caught bug 2.*
- **Is the external write ordered so a crash cannot destroy an existing record?**
  Delete-before-write fails this (a crash in between leaves a gap);
  write-first-then-delete-stale passes it (a crash leaves a recoverable, visible
  duplicate). *Caught bug 4.*

### 3. Lifecycle-interruption audit (an event fires mid-operation)

For every offline store the change touches, enumerate the events that fire while
work is un-synced: logout, shared-phone user switch, app kill / background, token
expiry, tab close. For each, ask "what un-synced data exists at that instant, and
does this event destroy it?"

- The specific trap is the wipe (`clearCrewState`): it must distinguish SAFE TO
  LOSE (a cache) from ONE COPY, IRREPLACEABLE (a signed BOL). ADR 0013 keeps
  rejected work; ADR 0021 extends that to PENDING work for one-copy artifacts,
  because "pending drains before the interruption" is false when crew hand a
  phone off mid-job offline.
- **Verify:** DevTools offline, create the artifact, do NOT reconnect, trigger the
  interruption (log out / switch user), then log the original user back in - the
  work is still there. *Caught bug 3.*

### 4. Environment-isolation-by-ID audit (staging must not touch prod)

For every external resource the change reads or writes - a Sheet tab, a Drive
folder, a bucket, a queue - confirm staging and prod resolve to DIFFERENT physical
resources, and that resolution is by a stable **ID**, not a **name** that can
collide.

- **Grep for name-based resource resolution.** A folder/tab resolved by name with
  a shared default means staging and prod resolve the SAME real resource - and an
  in-place update (e.g. Drive `files().update` by id) lets staging overwrite a
  prod document. Prefer an ID env var per environment (`DRIVE_*_FOLDER_ID`,
  `SHEETS_*_TAB`), listed in `.env.staging.example` + `docs/CREDENTIALS.md`, and
  flagged as load-bearing if unset silently falls back to the prod resource.
  *Caught the shared signed-BOL Drive folder.*
