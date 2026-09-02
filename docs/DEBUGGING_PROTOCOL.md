# Mountaineer Crew App - Debugging Protocol

**This protocol is mandatory for any debugging work on this project.** It is the
method for going from "something is wrong" to "the cause is known, fixed, and
proven fixed". Follow it in order. Do not skip to a fix.

## Which document you want

Three docs cover three different jobs. Opening the wrong one wastes a session.

| Situation | Doc |
|---|---|
| Something is broken or behaving wrong, and the cause is not yet known | **This doc** (`/debug`) |
| A named thing is broken and has broken before (backend down, Sheet junk, locked-out user, nightly email) | [RUNBOOKS.md](RUNBOOKS.md), start at its **Triage** section, it is faster than reasoning from scratch |
| A change is written and needs verifying before it reaches crews | [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md) (`/vet`) |

Debugging usually ends by handing off to the other two: a fix gets vetted, and a
new failure mode gets a runbook entry.

---

## Rule zero: the non-negotiables

These hold for every step below. Breaking one of them is a worse outcome than
not fixing the bug.

1. **All work goes to `staging`.** Confirm `git branch --show-current` prints
   `staging` before you edit anything. `main` is production and reaches crew
   phones. Never commit, push, or "just quickly test" a fix on `main` unless the
   user has explicitly said to promote. See the Branch rule in `CLAUDE.md`.
2. **Never touch production data to reproduce a bug.** Staging writes to the
   `*Staging` worksheets (`EventsStaging`, `MaterialsStaging`, ...) of Sheet
   `1KDWNudFSc8tlqV7lzq-M235swkgq7jWg_63ilrw_9hk` via the `SHEETS_*_TAB` env
   vars, and to the staging Postgres. Both environments share one Sheet file, so
   a debugging session that writes to an unsuffixed tab corrupts the admin's real
   records. Before any write-path experiment, confirm which tab you are pointed at.
3. **Evidence, never memory.** Every claim is backed by a file:line, a command and
   its output, an API response, or a log line. The codebase moves fast and your
   recollection of it is stale. "I believe X calls Y" is not a finding.
4. **Do not drive the user's browser.** The Chrome automation tools are off limits
   in this environment (tabs sync to the business partner's machine). Verify the
   frontend with `npm run build`, `npx tsc --noEmit`, and direct API calls. If a
   thing genuinely can only be seen on a rendered page or a real phone, say so
   plainly and ask the user to look and report back.
5. **Preserve the evidence before you change it.** If crew data is sitting in a
   broken state, capture it (row export, queue dump, log excerpt) before applying
   any fix. A fix that also destroys the only copy of the symptom is a dead end.
6. **No em dashes** in anything you write here, code or docs.

---

## STEP 1 - Write down the report before you read any code

Reading code first invents a theory before the facts are in. Record, in the
session, whatever of this is known:

- **The symptom in the reporter's own words.** Not your restatement of it.
- **Who saw it:** a crew member in the field, the admin in the office, you.
- **When:** date and rough time. This is what makes a log search possible, and it
  is what ties a symptom to a specific deploy.
- **Where:** production or staging. Do not assume. See STEP 2.
- **Which device:** phone (which one, iOS or Android), or desktop browser.
- **Scope:** one person, one job, one screen, or everybody.
- **Reproducible on demand, intermittent, or seen exactly once.**

Anything unknown is written down as unknown. An unknown that matters becomes a
question for the user, asked now, not after an hour of speculation.

## STEP 2 - Pin the environment and the build

More false starts on this project come from debugging the wrong copy of the app
than from anything else. There are two backends, two frontends, two databases,
and two sets of Sheet tabs, and the app is a PWA, so **the reporter's device may
be running a build that no longer exists in the repo.**

Establish, with evidence:

- **Environment:** which frontend host did they load, and which backend does it
  point at (`VITE_API_URL`)? A staging frontend talking to prod, or the reverse,
  produces symptoms that make no sense against the code you are reading.
- **Build:** which commit is deployed to that environment, and which commit was
  deployed at the time of the symptom? `git log`, plus the Vercel and Render
  deploy history. A bug reported on Tuesday against Monday's build is not the bug
  in today's `staging`.
- **The device's build, separately.** A phone with the service worker holding an
  old bundle is a different program from the one you just deployed. If the
  symptom is frontend behavior, the question "has this device taken the update?"
  is part of the diagnosis, not a footnote. Ask the user to force a reload.
- **Which Sheet tabs** the environment writes to, if the symptom is about data
  landing (or not landing) in the Sheet.

If the symptom is from production and cannot be reproduced on staging, say so
explicitly and treat every prod-only difference (env vars, data volume, Postgres
versus staging's DB, real crew accounts) as a candidate cause.

## STEP 3 - Reproduce, or state plainly that you cannot

A bug you cannot reproduce cannot be confirmed fixed. Try, in this order:

1. **Reproduce on staging** through the same path the reporter used.
2. **Reproduce against the API directly**, bypassing the UI, with an isolated
   script (httpx or the ASGI app against a throwaway SQLite DB, per the evidence
   toolkit in [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md)). This separates "the
   client sends the wrong thing" from "the server does the wrong thing" and is
   usually the single most informative five minutes of the session.
3. **Reproduce in a unit test** that fails now and passes after the fix.

If none of that reproduces it, **say "not reproduced" out loud and list what you
tried.** Do not quietly proceed to a fix. An unreproduced bug can still be worked
by reading, but every conclusion drawn that way is a hypothesis, must be labeled
one, and the fix needs a stated way for the user to confirm it in the field.

## STEP 4 - Triage the blast radius before you dig in

Ask, and answer in writing:

1. **Is data being lost right now?** Anything on a one-copy path (a signed BOL, a
   photo, a receipt, a queued offline write) that is failing silently is an
   emergency. Stop the loss first, diagnose second, and tell the user immediately
   rather than at the end of the investigation.
2. **Can a crew member in the field recover on their own?** A wrong total is an
   annoyance. A blank screen with no path forward, or a submit button that
   reports success while dropping the work, is not. High blast radius earns a
   higher bar at every later step and a second pass at STEP 9.
3. **Is it already a Known defect?** Check the Known defects list at the end of
   [RUNBOOKS.md](RUNBOOKS.md) and the Deviations sections of
   [DATA_FLOW.md](DATA_FLOW.md) / [DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md)
   before spending an hour rediscovering something already written down.
4. **Is it deliberate?** Search [docs/decisions/](decisions/) before "fixing"
   anything that merely looks wrong. Several things in this app are surprising on
   purpose and the ADR says why. Undoing one silently is how a fixed bug comes back.

## STEP 5 - State a hypothesis WITH its falsifier, before writing any fix

**This is the step this project has actually paid for skipping.** A backfill
stall on this app was diagnosed and confidently fixed three separate times (an
identity-map OOM, then a sweep storm, then an in-process schedule) and the first
two were not the cause. The one time measurement came first, it killed two wrong
hypotheses in a single run. See finding 7 and H6 in
[VET_POSTMORTEM_2026-08.md](VET_POSTMORTEM_2026-08.md).

For any behavioral, data, or performance defect, write these three lines before
touching the code:

```
Hypothesis:  <the specific mechanism you believe causes the symptom>
Falsifier:   <the observation that would prove this hypothesis WRONG>
Result:      <what you actually observed when you looked>
```

Rules:

- A hypothesis with no cheap falsifier is not ready. Narrow it until it has one.
- **Take the observation before writing the fix,** not after.
- If the falsifier fires, the hypothesis is dead. Say so and write the next one.
  Do not fix a hypothesis you just disproved because the fix is already typed.
- "The fix made the symptom go away" is not a falsifier. Symptoms move on their
  own here (a recycle, a deploy, a reload, a queue draining late).
- More than one plausible mechanism is normal. List them and design the single
  observation that separates them.

## STEP 6 - Localize with the evidence this app already gives you

Work down the actual data path rather than grepping for suspicious lines. Use
[DATA_FLOW.md](DATA_FLOW.md) (production) and
[DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md) (unpromoted staging work) as the map:
they record, per field, what triggers each exchange and when the transfer happens.

The path is: **device state -> offline queue -> API request -> DB row -> Sheet
row (and Drive file)**. Find the last stage where the data is correct and the
first where it is not. The bug is in between.

| Question | Where to look |
|---|---|
| Is the API healthy at all? | Backend root `/` returns `{"ok": true, ...}`; Admin -> Advanced Settings -> System Check covers DB, Sheets API, Drive API, env vars |
| Did the client ever send it? | Browser devtools Network on the reporter's device (ask them), or reproduce the call directly |
| Is it stuck in an offline queue? | `localStorage` keys `crew_*_queue_v1` (`crew_bol_queue_v1`, `crew_incident_queue_v1`, `crew_job_setup_queue_v1`, `crew_estimator_queue_v1`, `crew_ld_day_queue_v1`, ...) in `frontend/src/lib/` |
| Did the server accept it? | Render logs for that service, filtered by the tagged lines the backend prints: `[sheets]`, `[drive]`, `[bol]`, `[startup]`, `[forgot-password]`, `[auto-reconcile]` |
| Is it in the DB but not the Sheet? | `/api/admin/system-check/sheets`, `/api/admin/system-check/sheet-backfill`, and "Data is not reaching the Google Sheet" in [RUNBOOKS.md](RUNBOOKS.md) |
| Is it a memory or restart problem? | `/api/admin/system-check/worker` reports this process's RSS alongside `requests_served`. Read it on a fresh worker and again near a recycle |
| Is the app hanging for no reason? | Worker recycling. `--limit-max-requests 1000` is roughly fifty job screens, and each recycle is a multi-second outage. See the Render Start Command section in `CLAUDE.md` before touching the number |
| Did a deploy do it? | Vercel and Render deploy history against the symptom's timestamp; "A deploy broke something" in [RUNBOOKS.md](RUNBOOKS.md) |
| Is it Apps Script? | `apps_script/` is a fourth runtime that CI does not deploy. The repo file is the source of truth; what runs is whatever was last pasted into the Sheet's script editor. Confirm they match before debugging the file |

**Two silent-failure sweeps worth running early**, because both hide a bug rather
than showing it:

```
# A write endpoint that reports failure in the BODY but returns HTTP 200.
# apiFetch throws only on !res.ok, so the client reads it as success and DROPS the queued work.
grep -rn '"ok": *[Ff]alse\|return.*ok=False' backend/app/routers

# A swallowed write on the client. An empty catch on a localStorage/IndexedDB
# write reports success while losing the data.
grep -rn 'catch *{ *}\|catch (_*e*) *{ *}' frontend/src/lib frontend/src/auth
```

## STEP 7 - Find the cause, not the nearest suspicious line

Before accepting a cause, run the four lifecycle questions from
[VETTING_PROTOCOL.md](VETTING_PROTOCOL.md). The worst defects this app has
shipped were not defects in changed lines; they were interactions between a
change and a lifecycle event: a service worker update, a logout mid-sync, a
worker recycle, a device coming back online. Ask what else was happening at the
moment of failure.

A cause is accepted only when it explains:

- **the symptom**, all of it, including the parts that seemed incidental,
- **why it happens for this person, device, job, or environment and not others**,
- and **why it did not happen before**, if it is new.

A cause that explains three of four observations is not the cause yet. Say which
observation it does not explain and keep going, or state the residual explicitly
as an open question in the report.

## STEP 8 - Fix it, at the right layer

- **Smallest change that addresses the cause.** Do not refactor around a bug.
  Unrelated cleanups belong in [INCREMENTAL_WORK.md](INCREMENTAL_WORK.md), applied
  a few per commit in files you are already touching, never as the point of a fix.
- **Fix the cause, not the symptom.** Clamping a bad value where it is displayed,
  when it was written wrong three stages upstream, leaves the wrong data in the
  Sheet and in the DB, which is the admin's source of truth.
- **Preserve the core invariants** (`CLAUDE.md`): offline-first with no data loss,
  everything syncs to the Sheet, auth end to end, jobs keyed by `job_uuid` and
  never by name, simple and fast on mobile, admin views stay interpretable.
- **Never delete queued work** to make an error go away (ADR 0013). A queue entry
  that cannot be sent is a bug to diagnose, not garbage to clear.
- **Retryable mutations stay idempotent.** Keyed on the device-generated UUID
  (`event_id`, `submission_id`, `bol_id`, `rods_id` per day, `day_id`): calling
  twice yields one row and the existing record back, never a duplicate or a 500.
- **Validate on the server.** Hiding a control in the UI is not enforcement.
- **Existing bad data is part of the fix.** A fix that stops new corruption but
  leaves the already-written rows wrong is half a fix. Say what remains and
  propose the cleanup; do not run a bulk Sheet or DB repair without the user's
  explicit go-ahead.
- **New feature surface?** It carries the `beta` subtext via
  `<BetaTag feature="..." />` (`lib/betaFeatures.ts`) until the next `APP_VERSION`
  bump.

## STEP 9 - Prove it, with the measurement that could have falsified it

- **Re-take the STEP 5 observation.** The measurement that would have disproved
  the hypothesis now has to show the mechanism gone. "It seems fine" is not proof.
- **Confirm the original reproduction is dead**, by the same route that produced it.
- **Build clean:** `cd frontend && npm run build` (`tsc -b && vite build`), zero
  TypeScript errors. The >500 kB chunk-size notice is expected and is not a defect.
- **Backend:** `python -m py_compile` on changed files, plus an isolated test that
  drives the router function directly if behavior changed. Project venvs on this
  machine are broken (Python 3.14 versus 3.11 wheels); use a disposable venv.
- **Schema touched?** Exactly one Alembic head, and a real migration. Render runs
  `scripts/run_migrations.py` before uvicorn, so `create_all` is not a substitute.
- **Regression check:** name what else uses the code you changed and say how you
  know it still works. Grep for callers; do not assume there is one.
- **High blast radius (STEP 4) earns a second pass with a different question**, not
  a re-read. Specifically: given the class of this change, which historical failure
  mode in [VET_POSTMORTEM_2026-08.md](VET_POSTMORTEM_2026-08.md) applies here?
  Self-review mostly re-runs the reasoning that produced the code, and on this
  project it is the second, differently-framed pass that has found the real bugs.
- **Remove debug artifacts:** stray `console.log` / `debugger` in changed frontend
  files, `breakpoint(` in backend. The tagged `print("[bol] ...")` style lines are
  intentional operational logging and stay.
- **If it cannot be verified from here, say so.** "Cannot verify from here" is an
  honest result and it blocks a crew-facing promotion. It does not block a staging
  commit, but it must be written down and handed to the user as the thing to check.

## STEP 10 - Close the loop in the same commit

A fix is not done when the symptom is gone. Per the Definition of done in
`CLAUDE.md`, in the **same commit**:

- **Touched a queue, drain trigger, debounce timing, endpoint, or Sheet export
  path?** -> update [DATA_FLOW_STAGING.md](DATA_FLOW_STAGING.md), including the
  per-field table for that domain. [DATA_FLOW.md](DATA_FLOW.md) is the production
  baseline and changes only at promotion.
- **New failure mode, or an existing one diagnosed more cheaply?** -> add or
  sharpen the checklist in [RUNBOOKS.md](RUNBOOKS.md). This is how the next
  session takes two minutes instead of two hours.
- **Found a bug you did not fix?** -> add it to Known defects in
  [RUNBOOKS.md](RUNBOOKS.md). **Fixed one that is listed?** -> delete the entry.
- **Made a call someone would be tempted to undo?** -> write the ADR now, in
  [docs/decisions/](decisions/), applying the test in that folder's README. A
  non-obvious fix with no ADR gets reverted by the next person who reads it as a bug.
- **New env var or secret?** -> [CREDENTIALS.md](CREDENTIALS.md), names only, never
  values, and tell the user to set it on Render and Vercel, per environment.
- Run **`/handoff`** at the end of the session to sweep all of this, and **`/vet`**
  before the fix is promoted to `main`.

---

## Failure classes with extra obligations

If the bug is in one of these, the general steps above are not sufficient.

| Class | Also required |
|---|---|
| **One-copy / irreplaceable data** (signed BOL, photos, receipts, queued writes) | Run the **Durability vet for irreplaceable data** at the end of [VETTING_PROTOCOL.md](VETTING_PROTOCOL.md): earned-success audit, kill-test between DB commit and external write, lifecycle-interruption audit, environment-isolation-by-ID audit. Not optional for this class |
| **Offline queue / sync** | Reproduce offline, then reconnect. Check the entry is self-contained (no live handles, no in-memory references it cannot rebuild after a reload). Confirm nothing deletes queued work on failure |
| **Service worker / bundle / assets** | Walk install, activate, precache eviction, `controllerchange`, reload in writing, and state what the change assumes is in memory at each step. Route code splitting black-screened the app exactly here. A fix is not proven until staging has survived one real service-worker update |
| **Sheet data wrong** | Distinguish never-written, written-to-the-wrong-tab, written-then-overwritten, and duplicated. A header overwrite once produced 189 duplicate rows. Read the Sheet runbooks before writing any repair, and never bulk-edit the Sheet without the user's explicit approval |
| **Auth / password reset** | Check env vars first: `FRONTEND_URL`, `JWT_SECRET`, `DATABASE_URL`, Postmark token, `VITE_API_URL`. `grep` Render logs for `[forgot-password]`, which prints the generated link and exposes a wrong hostname instantly. A reset token lives in one DB and does not work against the other |
| **OOM / performance / "the app hangs"** | Measure before theorizing: `/api/admin/system-check/worker` RSS against `requests_served`. Flat RSS as requests climb means nothing is leaking on this build; climbing RSS means the recycle flag is doing its job and the leak is the bug. Do not raise `--limit-max-requests` to make a symptom quieter |
| **Apps Script** | Confirm the deployed script matches `apps_script/` before debugging. A change here ships only when somebody pastes it into the Sheet's script editor |

---

## Banned moves

Each of these has cost this project real time or real data.

- Fixing before the falsifier has been taken (STEP 5). This is the expensive one.
- Debugging `main`, or pushing a fix straight to `main` to see if it helps.
- Writing to a production Sheet tab while reproducing.
- Reasoning from memory of the codebase instead of reading it.
- Deleting or clearing queued offline work to clear an error.
- Reporting confidence as a count of things that passed. Assertions that were
  never derived from an observed failure are not evidence; confirmation is easy
  to accumulate and disconfirmation is what moves a diagnosis.
- Calling something fixed when the symptom stopped without the mechanism being
  understood. On this app symptoms stop on their own: a recycle, a redeploy, a
  reload, a queue draining late.
- Widening a fix into a refactor.
- Driving the user's Chrome to check a page.
- Bulk-repairing Sheet or DB rows without explicit approval.

---

## Report format

End every debugging session with this, whether or not the bug was fixed:

```
SYMPTOM      What was reported, in the reporter's words.
ENVIRONMENT  Prod or staging, frontend/backend hosts, commit deployed, device.
REPRODUCED   Yes (how) / No (what was tried).
BLAST RADIUS Data at risk? Can crew self-recover? Known defect already? ADR'd?
HYPOTHESIS   The mechanism.
FALSIFIER    The observation that would have disproved it.
RESULT       What was actually observed.
CAUSE        file:line, and why this person / device / environment / now.
FIX          What changed and at which layer. Existing bad data: handled or outstanding.
PROOF        The re-taken measurement, the dead reproduction, build/test output.
UNVERIFIED   Anything that could not be checked from here, and who checks it.
DOCS         DATA_FLOW_STAGING / RUNBOOKS / Known defects / ADR / CREDENTIALS updates.
```

An unfinished investigation reports the same fields with honest blanks. A blank is
useful to the next session. A guess written in as a fact is not.
