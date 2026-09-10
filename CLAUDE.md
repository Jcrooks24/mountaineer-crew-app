# mountaineer-crew-app

Crew-facing app used in the field on mobile. `backend/` is FastAPI + Postgres + Alembic; `frontend/` is Vite/React. Backend deploys on Render, frontend on Vercel. Synced data lands in a shared Google Sheet.

This file is the **operating manual**: the rules, the invariants, and the procedures. It is not a changelog and not a feature list.

## Documentation map

| Doc | For |
|---|---|
| [README.md](README.md) | The front door. What this is, where it lives, how to run it. Start a successor here. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | What the pieces are and how they talk. Read before changing anything structural. |
| [docs/DATA_FLOW.md](docs/DATA_FLOW.md) | The field-level ledger for **production**: for every piece of data, what triggers the exchange and when the transfer happens. Queue keys, drain functions, debounce timings, Sheet export functions, per-field adherence. Read this when debugging what crews are actually running. |
| [docs/DATA_FLOW_STAGING.md](docs/DATA_FLOW_STAGING.md) | The same ledger for **unpromoted staging work**, as a delta. New dev work is logged here in the same commit as the code, and folded into DATA_FLOW.md at promotion. |
| [docs/RUNBOOKS.md](docs/RUNBOOKS.md) | Step-by-step checklists for when something is broken. Also holds the **Known defects** list. |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Every account, env var, and API. What breaks without each. **No secret values, ever.** |
| [docs/decisions/](docs/decisions/) | Why things are the way they are. **Read before "fixing" something that looks wrong.** |
| [docs/business/](docs/business/) | The company this app serves: who does what, the SOP, the tools audit, the M1 merger assessment. **Read before deciding whether a feature should exist.** |
| [docs/DEBUGGING_PROTOCOL.md](docs/DEBUGGING_PROTOCOL.md) | **Mandatory for any debugging work** (`/debug`). How to go from "something is wrong" to a proven cause: pin the environment and build, reproduce, triage blast radius, then **hypothesis + falsifier before any fix**. |
| [docs/INTAKE_PROTOCOL.md](docs/INTAKE_PROTOCOL.md) | **How the assistant works here** (`/intake`). Ask direction as a multi-select before executing, capture the real-world scenario in the owner's words, record which user classes it touches. **No size exception** ([ADR 0046](docs/decisions/0046-every-change-goes-through-a-direction-intake.md)). Also holds the ADR review ledger. |
| [docs/PRD.md](docs/PRD.md) | What each capability is **for** and **who** it serves, in the owner's words. Written from intake answers only. **Nothing enters its body that the owner did not say**: no inference, ever. |
| [docs/USER_PROFILES.md](docs/USER_PROFILES.md) | Who actually uses this app, under what conditions, for what. One profile per user class. `[confirmed]` vs `[inferred]` marks are load-bearing: an inferred line is an intake question, not a fact to build on. |
| [docs/SANITY_CHECK_PROTOCOL.md](docs/SANITY_CHECK_PROTOCOL.md) | The workflow/UX/UI review (`/sanity`). **Findings only, fixes nothing.** Asks whether a tool is the right answer to the job it exists for, and whether its category covers every real scenario. Runs before a feature is called done, and periodically on old features via its Coverage ledger. |
| [docs/VETTING_PROTOCOL.md](docs/VETTING_PROTOCOL.md) | The pre-promotion test protocol (`/vet`). **Start at STEP 0**, which is not diff-derived. |
| [docs/VET_POSTMORTEM_2026-08.md](docs/VET_POSTMORTEM_2026-08.md) | Why STEP 0 exists: every defect that reached crews since the v1.8 merge, and what the protocol was structurally blind to. Read before deciding a check is unnecessary. |
| [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) | Admin-facing guide: what admin can do in the app. Keep accurate against `Admin.tsx` / `admin.py`. |
| [docs/CREW_GUIDE.md](docs/CREW_GUIDE.md) | Crew-facing reference & troubleshooting guide (every feature + failure modes). Master formatted copy lives in the shared doc. |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | The visual contract: tokens, primitives, patterns. Read before restyling or building a screen. Rationale in [ADR 0030](docs/decisions/0030-enterprise-design-system-facelift.md). |
| [docs/INCREMENTAL_WORK.md](docs/INCREMENTAL_WORK.md) | Cleanups paid down opportunistically, a few per commit, in files you are already editing. Check it whenever you touch a frontend file. |
| [docs/PROMOTION_CHECKLIST.md](docs/PROMOTION_CHECKLIST.md) | Every pre- and post-merge step for `staging -> main`: Sheets mirror, env vars by environment, Apps Script pastes, email workflows, patch note, crew email, in-app config. Driven by `/promote`. |

## Intake rule (applies to every change, before the change)

**Ask before executing. Every time, no size exception.** [docs/INTAKE_PROTOCOL.md](docs/INTAKE_PROTOCOL.md) (`/intake`), decided in [ADR 0046](docs/decisions/0046-every-change-goes-through-a-direction-intake.md). A one-line defect fix goes through it the same as a feature, because deciding what is "big enough" to ask about is itself the leak, and small changes are where the wrong assumptions have historically entered.

1. **Direction as a multi-select**, two to four genuinely different options, recommendation first and labeled, each saying what it costs and what it forecloses. Never an open "what would you like?"
2. **The reason: what crew or admin real-world scenario drives it?** Who, doing what, when, and what goes wrong today.
3. **Which user classes it touches, how and why**, written into [docs/USER_PROFILES.md](docs/USER_PROFILES.md) in the same commit.
4. **Grade the answers** against concrete / causal / bounded / checkable-later, and **surface the grade only when it falls short.** Then either a confirm multi-select whose options are the exact sentences that would enter the record, or one targeted question. **One follow-up round, never two.**

5. **Check every answer for contradictions**, against the stated record (PRD lines, `[confirmed]` profile lines, ADR scenarios and assumptions from 0046 on) and against answers earlier in the same session. A **direct conflict** or **scope tension** stops the work: show the prior line quoted with its date, the new statement, and what each implies, then wait. **The prior line must be quotable with its date, or it is not a flag.** Name lines, never the person, and never re-raise a flag already ruled on.

**While answers are pending**, do only work no answer could change (read code, reproduce, write the failing test, build checks). Stop before the fix, the schema, the UI, the copy. **Commit nothing before answers land**, and discard redirected work without arguing for it.

**Carve-outs, about safety and not size:** active data loss is stopped first and asked about after, and the owner may waive intake for a specific change, with the waiver noted in the commit message.

**The answers become the product record.** [docs/PRD.md](docs/PRD.md) owns what a capability is for and who it serves, in the owner's words, and **nothing may enter its body that the owner did not say**. An ADR owns which approach was taken and why not the other, and links up to its PRD entry rather than restating the scenario. The same sentence is never written in both.

## Definition of done

A change is not done when the code works. It is done when the next person can still run this system without you. Every change, in the **same commit**:

1. **Code works**, verified by exercising it, not just by typecheck. **A new feature is not done until it has been through a sanity check** ([docs/SANITY_CHECK_PROTOCOL.md](docs/SANITY_CHECK_PROTOCOL.md), `/sanity`) and the user has ruled on its findings. That pass comes **before** the vet, because anything it turns up becomes code that then needs vetting.
2. **New env var, secret, or Google API?** → it is in `docs/CREDENTIALS.md`, and the user has been told to set it on Render/Vercel.
3. **New service, integration, queue, or data flow?** → `docs/ARCHITECTURE.md` and its diagram still match reality.
   **Touched a queue, a drain trigger, a debounce timing, an endpoint, or a Sheet export path?** → `docs/DATA_FLOW_STAGING.md` is updated in the same commit, including the per-field table for that domain. Adding a field to a payload without adding it there is how that doc goes stale. `docs/DATA_FLOW.md` is the production baseline and changes only at promotion.
4. **Made a decision someone would be tempted to undo?** → write the ADR in `docs/decisions/` now. Apply the test in that folder's README. **From [ADR 0046](docs/decisions/0046-every-change-goes-through-a-direction-intake.md) on, every ADR carries three extra lines**: `Driving scenario` (the owner's words), `User classes affected`, and `Assumption this rests on`. The last one is what makes a decision checkable later instead of only re-arguable. **Did the change define or change what a capability is for?** → that sentence goes in [docs/PRD.md](docs/PRD.md), in the owner's words, and the ADR links to it instead of repeating it. **No ADR earned?** → the driving scenario still gets written, as a `Why` paragraph in the commit message.
5. **Found a bug you did not fix?** → add it to Known defects in `docs/RUNBOOKS.md`. **Fixed one that is listed?** → delete the entry.
6. **Changed setup, local dev, or deploy?** → `README.md` is current.
7. **Edited a frontend file?** → check [docs/INCREMENTAL_WORK.md](docs/INCREMENTAL_WORK.md) and apply any items that match **the files you already touched**. A few per commit, noted in the commit message. Do not go hunting in other files, and do not let it become the point of the commit. Skip anything not obviously safe.

Run **`/intake`** before starting a change. Run **`/handoff`** at the end of a working session to sweep all of this. Run **`/sanity`** before calling a feature done. Run **`/vet`** before promoting to `main`.

## Sanity check rule

**A feature is not done because it works.** [docs/SANITY_CHECK_PROTOCOL.md](docs/SANITY_CHECK_PROTOCOL.md) (`/sanity`) reviews the tool the way a person uses it: does it do its stated job, does its whole category of tool have an answer for every real scenario (job cancelled on arrival, crew swapped mid-day, no signal all day, nobody started it until 4 PM), is the friction as low as it can be, are confirmations where they matter and absent where they are noise, does it fit the rest of the app, are its code-level preconditions actually true, and does it render in an organized way with no sticky buttons or silently-submitted default values.

**It reports and changes nothing.** Findings go to the user, who decides what becomes work; more than one approved finding runs through Batch mode in the debugging protocol. It also runs periodically on features nobody flagged: take the oldest row in that doc's **Coverage ledger**, run the pass, update the row. One area per session, the same way [docs/INCREMENTAL_WORK.md](docs/INCREMENTAL_WORK.md) is paid down.

## Debugging rule

**Any debugging work follows [docs/DEBUGGING_PROTOCOL.md](docs/DEBUGGING_PROTOCOL.md)** (`/debug`). It is not optional and it is not only for hard bugs. Its load-bearing step is STEP 5: for any behavioral, data, or performance defect, write the hypothesis, write the observation that would **disprove** it, and take that observation **before** writing a fix. Shipping a fix for an unmeasured hypothesis is how the same bug gets fixed three times, which has already happened here.

**A list of bugs is not fixed as it is read.** More than one defect at once goes through Batch mode in that doc: explore the whole list first fixing nothing, propose a fix for every item and **wait for per-item approval**, then fix sequentially with a checkbox progress list kept on screen and re-posted as each item changes state. Active data loss is the one thing reported and stopped without waiting.

Use [docs/RUNBOOKS.md](docs/RUNBOOKS.md) first when the broken thing is one that has broken before, and `/vet` afterwards, before the fix reaches `main`.

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

**`--limit-max-requests 1000` has a cost, and it is the one crews feel.** Every
recycle takes the service down while migrations run and the app is imported. The
app import alone measures ~2.3 s on a fast laptop and Render's CPU is slower, so
a recycle is a multi-second outage. Opening one job costs about twenty requests,
so 1000 requests is roughly fifty job screens: on a working afternoon the service
restarts repeatedly and crews experience it as the app hanging for no reason.

Do not just raise the number. The flag exists to cap a slow leak, and trading a
visible pause for an OOM kill is a bad trade. **Decide it with the data:**
`GET /api/admin/system-check/worker` reports this process's RSS alongside
`requests_served`. Read it on a fresh worker and again near a recycle:

- **RSS flat as requests climb** - nothing is leaking on this build, and the
  limit can go up (5000 is a 5x reduction in restarts). Re-check after.
- **RSS climbing with requests** - the flag is doing its job. Find the leak
  before touching the number.

`scripts/run_migrations.py` already skips the alembic upgrade entirely when the
database is stamped at head, which it is on every recycle (as opposed to every
deploy). That removed a few hundred milliseconds of a multi-second window; the
frequency is the rest of it.

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

**Start with `/promote`.** It runs `scripts/promotion_gate.py --report` and walks
[docs/PROMOTION_CHECKLIST.md](docs/PROMOTION_CHECKLIST.md), which covers the
things this section does not: the Sheets mirror and column safety, new env vars
by platform and environment, Postmark/OAuth manual setup, Apps Script pastes (a
runtime CI does not deploy), the full email-workflow inventory, the patch note,
the mass crew email, and in-app config that does not travel with the merge. The
steps below remain the mechanical merge procedure.

1. **Merge** `staging` into `main`. Render auto-deploys main on push.
2. **Verify the start command above is set** on the Render prod service before promoting (only needed once; persists across deploys). Migrations now run as part of the start command, not at app startup.
3. **Run the user-migration script:** `backend/scripts/migrate_users_staging_to_prod.py`. It copies `email`, `password_hash`, `name`, `role`, `is_active`, `profile_photo`, `is_skill_rater` from staging Postgres to prod Postgres with `ON CONFLICT (email) DO NOTHING` (prod wins on conflicts). Crew who only exist on staging would otherwise have to re-register. Dry-run first:
   ```
   STAGING_DATABASE_URL=... PROD_DATABASE_URL=... \
     python backend/scripts/migrate_users_staging_to_prod.py --dry-run
   ```
4. **Verify prod env vars** (see checklist below). Missing/stale values here have caused a crew member to be unable to reset their password post-promotion.
5. **Vet the data-flow docs.** Fold `docs/DATA_FLOW_STAGING.md` into `docs/DATA_FLOW.md`, empty the delta, and bump "Verified against". See the Data-flow doc gate in [docs/VETTING_PROTOCOL.md](docs/VETTING_PROTOCOL.md). **A new staging data flow that does not pass blocks the merge**: any `[ ]` field, any newly-introduced deviation, or any changed data path missing from the staging doc. Deviations `main` already carries do not block. A blocker clears only by fixing it or by an explicit written waiver from the user.

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
