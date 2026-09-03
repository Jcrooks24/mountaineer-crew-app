# Promotion checklist (staging -> main)

Work through this on **every** merge to `main`. It is the human half of the
promotion; the machine half is `scripts/promotion_gate.py` (run that first, it
answers several of the questions below for you).

```
python scripts/promotion_gate.py --base-ref origin/main --report
```

`--report` prints the env-var diff, Apps Script changes, and sheet column
changes as an advisory block, so sections 2, 3 and 4 start from facts rather
than memory.

Order matters: **1-7 before the merge, 8-11 after.**

---

## 1. Run the gate, clear or waive every blocker

Duplicate ADR numbers, split migration chain, `[ ]` fields and open deviations in
`DATA_FLOW_STAGING.md`. A waiver is a `GATE-WAIVER: <check-id> <reason>` line in
that doc and needs a real reason. See RUNBOOKS "Promotion gate".

## 2. Sheets: is it still a true mirror of the server?

Two different questions, both required.

**a. Does the data still land in the right place?**

- Run `backend/scripts/sheet_integrity_check.py` against **prod**. Zero FAILs:
  no duplicate keys, no overwritten KEY column, no junk tabs. WARNs about
  columns not yet promoted are expected pre-promotion.
- Admin -> Advanced Settings -> **System Check, Sheet Syncs**: Sheets connected,
  every sync's tab exists, no recent export errors.
- Any NEW sheet sync must be in `SHEET_SYNC_REGISTRY` in `sheets_export.py`, or
  the health check cannot see it.

**b. Will new fields disturb existing columns?**

The gate diffs every `*_HEADERS` list against `main` and classifies each change:

- **NEW TAB** - no existing data to disturb. Safe.
- **APPEND** - columns added at the end of the list. Safe.
- **MID-LIST INSERT** - columns added in the middle. **Not corruption, but read
  this:** `_ensure_tab` reads the sheet's *actual* header row and appends only
  missing columns to the right, then `_build_row` maps positionally against that
  real order. So existing prod rows do **not** shift. What it does mean is that
  prod's tab ends up in a different **column order** than a freshly created tab
  on staging. The two environments stop being visually identical, and anyone
  reading column letters (or an Apps Script that hardcodes a column index) will
  be wrong on one of them.

  So on a mid-list insert: confirm nothing downstream addresses that tab by
  column letter or index, and decide whether you want to reorder the prod tab by
  hand to match.

> Currently flagged: **nothing.** The gate reports no header changes as of
> 2026-08-11. The `BOL_HEADERS` mid-list insert (11 columns, `shipment_number`
> through `agreed_delivery`, after `item_count`) shipped with the v1.8 promotion,
> so prod's BOL tab already carries those columns appended at the far right
> rather than in list order. That column-order difference between prod and a
> freshly created staging tab is now permanent unless someone reorders it by
> hand. Nothing addresses that tab by column letter today; re-check if an Apps
> Script ever does.

## 3. New environment variables

The gate prints variables read on `staging` but not on `main`. **It only catches
literals** - `os.getenv("FOO")`. Variables read through a constant
(`os.getenv(DQ_FOLDER_ID_ENV_VAR)`) are listed separately from the
`*_ENV_VAR = "..."` declarations, but a var built by string concatenation will be
missed. Check `docs/CREDENTIALS.md` too.

For each one, record **which platform and which environment**:

| Variable | Platform | Environment | Set? |
|---|---|---|---|
| | Render / Vercel | staging / prod / both | |

Anything with a folder or tab ID needs a **different value per environment**, or
staging writes into production. That is the single most common way this list
hurts you.

> Currently outstanding: **nothing blocking.** Confirmed with the owner
> 2026-08-11: `ALERT_EMAIL`, `SHEETS_BUGS_TAB` and `SHEETS_FEATURE_REQUESTS_TAB`
> are set on Render prod, and `DRIVE_DQ_FOLDER_ID`
> (`1ffMaMNOf5MAZL3sSw5UucWmXeZHKI8WW`) is the **production** Drive folder, so it
> belongs on Render prod and must **not** be reused on staging.
>
> `MEMPROBE` is new on this promotion and is deliberately **not** to be set
> anywhere: it turns on `[mem]` RSS checkpoints in any process, and the
> sheet-integrity cron enables them itself. Leave it unset.

Also re-run the standing post-promotion env checks in CLAUDE.md: `FRONTEND_URL`,
`JWT_SECRET`, `DATABASE_URL`, Postmark token on Render prod; `VITE_API_URL` on
Vercel prod.

## 4. Apps Script

`apps_script/` is **a fourth runtime that CI does not deploy.** The files here are
the source of truth; what actually runs is whatever has been pasted into the
Sheet's script editor. A change here is not shipped until somebody pastes it.

The gate lists files changed between `main` and `staging`. For each:

- [ ] Opened the correct Sheet -> Extensions -> Apps Script
- [ ] Pasted the new contents, saved
- [ ] Confirmed the trigger still exists and is on the right schedule
- [ ] Ran it once by hand and checked the execution log

> **Currently outstanding: `apps_script/nightly_crew_email.gs` (changed
> 2026-08-27).** The dedupe read the content hash from a fixed column 5, which
> does not exist in the four-column `BugEmailLog` / `FeatureRequestEmailLog`, so
> the digest re-sent every bug report and feature request ever filed, every
> night. **Until this is pasted in, that keeps happening** - the fix is in the
> repo, and the repo is not what runs.
>
> Paste it into the **prod** Sheet's script editor, then run
> `dryRunNightlyCrewEmail()` and read View > Logs. A correct dry run is short:
> only genuinely new items. If it still lists the whole history, the paste did
> not take. `node apps_script/nightly_crew_email.test.js` checks the same logic
> offline and needs no Sheet access.
>
> The previous paste (after the v1.8 promotion, confirmed with the owner
> 2026-08-11) is what the trigger is still running. Re-check the trigger schedule
> if the nightly digest goes quiet.

## 5. Postmark / OAuth manual configuration

- **Postmark:** is the prod server token set on Render prod (not staging's)? Is
  the `SMTP_FROM` sender verified in Postmark for the prod domain? A new
  recipient domain does not need setup; a new *sender* does.
- **Google OAuth / service account:** any new Drive folder or Sheet must be
  shared with the service account, or writes fail with a 404 that reads like a
  missing file. Any new API scope requires re-consent.
- Check `docs/CREDENTIALS.md` for what each account is and what breaks without it.

## 6. Email workflow inventory

Every path in the app that results in a sent email. Confirm each still works
after promotion, and that the **sender** is the prod sender.

| Trigger | Tool | Sender | Recipient |
|---|---|---|---|
| Password reset request | Postmark (`core/mailer.py`) | `SMTP_FROM` | The crew member resetting |
| Admin "send test email" | Postmark | `SMTP_FROM` | Address typed by admin |
| Signed BOL delivery | Postmark | `SMTP_FROM` | The customer on the BOL |
| DVIR mechanic sign-off needed | Postmark | `SMTP_FROM` | `mechanic_email` on the DVIR |
| Bill/job-hour correction initialing | Postmark | `SMTP_FROM` | The affected crew member (per job) |
| Payroll notifications (2 paths) | Postmark | `SMTP_FROM` | The affected crew member |
| Nightly crew feedback + incidents digest | **Apps Script** `MailApp` | The Google account that owns the script | Office |

Note the last row: it is the only one that does **not** go through Postmark, does
not use `SMTP_FROM`, and is not deployed by CI. It is the one most likely to be
silently broken after a promotion.

## 7. Backlog check

Before merging, confirm nothing half-finished is riding along:

- `docs/RUNBOOKS.md` **Known defects** - anything tagged `STAGING ONLY, BLOCKS
  PROMOTION` must be fixed or explicitly waived.
- `docs/INCREMENTAL_WORK.md` - opportunistic items do NOT block, by design.
- Any feature batch in flight that should land whole rather than split across two
  promotions.

---

## 7b. Dated cutovers baked into the code

Constants that decide behaviour by a calendar date. They are written assuming a
promotion soon after, and a promotion that slips turns them into a cutover in the
PAST, which is the opposite of what they were for.

- [ ] **`PAYROLL_ROUNDING_EFFECTIVE_FROM`** in `backend/app/core/hours_rounding.py`.
      Payroll quarter-rounding applies to periods STARTING on or after this date.
      It was set to 2026-09-10, one week out from when the change was written, so
      the first rounded period would be one nobody had begun reconciling.
      **If that date has passed, bump it** to the start of the next unreconciled
      period before merging. Leaving it stale restates periods people have
      already been paid for, the moment anyone re-opens them. Rounding is not
      retroactive by explicit decision (2026-09-03), and this is the only thing
      enforcing that.

## 8. In-app configuration, post-merge

Config that lives in the database, not the code, and therefore does **not** come
across with the merge:

- [ ] **Skill raters.** ADR 0014: `crew_lead` does not grant skill rating. Every
      prod crew lead who should keep rating needs the **Skill rater** toggle set
      in Admin -> roster. The user-migration script is `ON CONFLICT DO NOTHING`
      and will not do it. Do it in the same sitting or leads quietly lose the
      feature overnight.
- [ ] **Reimbursement / per-diem rates** (ADR 0033) exist in prod SystemConfig.
- [ ] **DQ document type catalog** matches what the office expects.
- [ ] **Anything left undone from a prior merge** - check the bottom of this file.

## 9. Patch note

Draft in Admin -> Patch Notes. Scope must cover **every** change in the
promotion, not just the headline feature. For a 100+ commit promotion, read
`git log --oneline origin/main..origin/staging` in full.

Cover: new features, bug fixes, and **any workflow change** - anything where the
crew's existing muscle memory now leads somewhere different. Workflow changes
matter more than features; a crew member who cannot find a button assumes the app
is broken.

No em dashes (company invariant).

## 10. Mass crew email

Required when the promotion changes **where things live** or **how a task is
done**, not merely when it is large. A hundred commits of backend hardening needs
no email. One moved button does.

Include: what changed, what they should do differently, what to do if something
looks wrong, and who to contact.

## 11. Repoint anything that tracks a branch

- [x] Render **Cron Job** for the sheet integrity check: **already tracks
      `main`** (confirmed from its own run log, "Checking out ... in branch
      main"). Do not assume, and do not switch it back. The practical
      consequence, which has caught us out: a fix pushed to `staging` does
      **not** reach this cron. It ships only at a promotion.
- [ ] Any other Render/Vercel service pinned to `staging`.

---

## Carried over, still undone

Items that were on a previous promotion's list and never got done. **Clear this
section as part of the promotion, or explain why it is still here.**

### After the 2026-08-13 PM promotion (`7081f4f`, 11 commits, ONE migration)

The performance batch. Migration `i9k1m3h5j7l9` adds two nullable columns to
`job_reports` with no backfill.

1. **Confirm Render PROD ran `i9k1m3h5j7l9` BEFORE the Vercel build reaches a
   phone.** The close-out screen writes `variance_direction` and
   `variance_cause_identified`; a frontend ahead of its backend is what caused
   both 08-12 bugs, and Vercel usually wins that race.

2. **Read the boot line in the Render log.** It now prints its own timing:
   `[migrations] already at head (i9k1m3h5j7l9) - nothing to do [N ms]`. On the
   DEPLOY it will run the real upgrade; on every recycle after, it should say
   "already at head" in single-digit milliseconds. If it is still running a full
   upgrade on recycles, the fast path is not engaging and the boot is slower than
   it needs to be.

3. **THE ONE THAT UNLOCKS THE REST: read
   `GET /api/admin/system-check/worker`** on a fresh worker, then again near a
   recycle (`requests_served` approaching 1000). RSS flat across that span means
   nothing leaks on this build and `--limit-max-requests` can go up - 5000 is a
   5x cut in the restart pauses, which is a bigger win than everything else in
   this promotion combined. RSS climbing means the flag is earning its keep and
   the leak comes first. See the start-command section in CLAUDE.md.

4. **Watch the first prod deploy for chunk-recovery** (see the unverified list
   below). Anyone with the app open across the deploy who then navigates to a
   lazy route is the test. Symptom if the guard is wrong: an error page on one
   screen, cleared by a refresh. Bounded.

5. **Crew-visible change worth a patch note:** the job report close-out is now a
   short stepper, two duplicate questions are gone, and causes are picked from
   three dropdowns instead of one long chip list. Crews who learned the old
   screen will notice immediately.

### Device testing status for the 2026-08-13 PM promotion (`7081f4f`)

Kept here rather than in a chat log, because "was this actually tried on a phone"
is the question every one of these promotions turns on.

**Verified on staging, on a device (2026-08-13):**

- [x] **Offline navigation after the route split.** This was the batch's biggest
      risk: route chunks are downloaded separately, so a chunk missing from the
      service-worker precache would white-screen a crew member the moment they
      navigated with no signal. Confirmed working.

**Still unverified, and honestly cannot be from a desk:**

- [ ] **Chunk recovery across a deploy** (`lib/lazyRoute.ts`). Needs the app open
      on a device, a deploy landing under it, then navigating to a lazy route.
      Two deploys and a live phone. The offline test above does NOT cover this -
      it proves the chunks are cached, not that a build MISMATCH recovers.
      Failure mode if the guard is wrong: an error page on one screen, cleared by
      a manual refresh. Bounded, not dangerous.
- [ ] **The close-out stepper** on a real job report. The screen crews use daily.
- [ ] **The restart banner** actually appearing during a recycle, and clearing.

### After the 2026-08-13 promotion (`ac98585`, 5 commits, ONE migration)

`h8j0l2g4i6k8` adds `bulletin_posts.reaction_mode`. It is NOT NULL with a server
default, so nothing needs backfilling, but the deploy must run it before the new
frontend reaches a phone - both bugs reported on 08-12 were a frontend deployed
ahead of its backend, and Vercel usually wins that race.

1. **Confirm the Render PROD deploy ran `h8j0l2g4i6k8`.** Look for
   `[migrations] Alembic upgrade head - done.` If the frontend lands first, the
   bulletin feed will 500 on `reaction_mode` until the backend catches up.
2. **The dislike control renders only for `j.a.crooks24@gmail.com`.** Sign in as
   that account and confirm the pill appears; sign in as anyone else and confirm
   it does not. The server refuses everyone else regardless (404), so a UI slip
   here is cosmetic, not a hole - but it is worth one look.
3. **Bill total on the crew closed-job panel.** Open any closed job and confirm
   the amount matches what the admin Job Summary shows for the same job. Those
   two now share one implementation; if they disagree, the shared helper is wrong
   for both.

### Still outstanding from the 2026-08-13 promotion (`a35011a`)

The truck-billing fixes, the auto-reconcile throttle fix, and the drain estimate.
Nothing to configure - but one thing genuinely needs watching, because the fix
that shipped only removes a KNOWN cause and cannot prove it was the only one.

1. **Read the next `[auto-reconcile] generic:` line in the prod Render log**
   (within ~20 minutes of the deploy). The number after `backlog before sweep`
   is the one to track ACROSS two or three sweeps. Falling means the storm was
   the whole story and it is now draining on its own. Flat means there is a
   second, independent reason those records will not export - in which case the
   `last failure:` lines now printed underneath name it, and that is the thread
   to pull. **Do not conclude anything from a single sweep**: the count is
   measured before the sweep runs, so one line in isolation says nothing.
2. **Watch that the sweep is actually skipping, not stalling.** `skipped:
   previous batch still draining` is correct and expected between sweeps. Seeing
   it on every sweep for over an hour is not - that would mean something is
   re-arming the cooldown continuously, and the sweep would never run again.
3. **Nothing was device-tested here**, but the only crew-visible change is the
   missing-truck-line warning on the invoice builder. Worth one look at a real
   job on a phone before trusting it to prevent the next under-bill.

Still open from the promotion below: the DATA_FLOW fold (now four promotions
old), device testing, and `repair_forked_jobs.py`.

### After the 2026-08-12 promotion (25 commits) - DO THESE IN ORDER

1. **Confirm the Render PROD deploy finished and all FOUR migrations ran**
   (`d4f6h8c0e2g4`, `e5g7i9d1f3h5`, `f6h8j0e2g4i6`, `g7i9k1f3h5j7`). Look for
   `[migrations] Alembic upgrade head - done.` in the deploy log.

   **This is the first thing, not a formality.** Both symptoms reported on
   2026-08-12 - a 404 on the waiver and `[object Object]` on report initialing -
   were a frontend deployed ahead of its backend. Vercel and Render deploy
   independently and the frontend usually wins.

   If the deploy half-fails, the visible symptom of the missing `worker_leases`
   table is the auto-reconciler silently not sweeping, which reads as "nothing to
   reconcile" rather than as an error.

2. **Read the next nightly integrity email.** Expect the JobReports and BOLs
   "expected column(s) absent" warnings to CLEAR once an export runs and widens
   those grids. `Bills` (33), `DVIRs` (1) and `PriorOnDuty` (1) may also drain.
   Anything still missing after that is genuinely stuck.

3. **Grep the prod Render log for `[sheets] background export failed`.** This is
   the one open question the code cannot answer for itself: it names the actual
   exception behind records that will not drain. The new failure panel in Admin
   -> Sheet Backfill surfaces the same thing now that it is promoted.

4. **Only after crews have loaded the new bundle**, repair forked jobs:
   ```
   python backend/scripts/repair_forked_jobs.py            # report first
   python backend/scripts/repair_forked_jobs.py --apply
   ```
   Not before. A device still holding an orphan uuid keeps writing under it until
   it next resolves online, so repairing early just lets new orphans appear
   behind the script. See [ADR 0038](decisions/0038-forked-job-repair-moves-rows-and-refuses-to-merge.md).

   **How to know it is safe, instead of guessing at a number of days.**
   `GET /api/patch-notes/history` returns every build a crew device has actually
   reported, each with `last_seen_at`. Adoption is readable, not estimated:

   - Find the builds whose `first_seen_at` PREDATES the promotion.
   - Look at their `last_seen_at`. A recent timestamp on an old build means at
     least one device is still running the old bundle right now.
   - When no pre-promotion build has been seen for a couple of days, the devices
     that open the app have taken the update.

   **The limit of that signal, which matters here specifically.** The table
   records builds REPORTED BY A DEVICE. A phone that has not opened the app at
   all reports nothing, so "no old build seen recently" means "nobody who has
   used the app recently is stale" - not "everybody updated". A crew member back
   from a week off, opening a bundle from before the promotion, is exactly the
   device that creates a fresh orphan, and it is invisible to this check until
   they open the app.

   So: use the history to rule out the obvious "too early", then run the DRY RUN
   whenever you like. It only reads. If it reports forks that keep appearing
   between runs, devices are still stale and the answer is to wait, not to apply.

5. **Tell the office the Sheet's `entered_by` column changes.** It now shows full
   names instead of typed initials, and `(waived)` on a waived job (ADR 0037).
   Anything reading that column must treat it as free text.

6. **Device testing. Nothing in this promotion has run on a phone.** Three static
   review passes each found bugs the previous one missed, and none of them can
   substitute for this. Highest value first:
   - the mobile roster breakpoint (760px, cards + tap-to-expand)
   - the timeline confirmation toast's position against the fixed bottom nav
   - the bulletin feed and photo aspect ratio
   - the truck-fullness editor, now one entry per LOAD
   - the long-outstanding bottom-nav drift test

7. **Decide whether these should reach the Sheet.** Reimbursement approval
   status, the payroll report waiver, and the app build history all live only in
   Postgres. Logged as "read" not `[x]` in DATA_FLOW_STAGING. The Sheet is the
   durable record, so this is worth deciding rather than discovering.

8. **Publish a patch note, and consider a crew email.** Unlike the 2026-08-11
   promotion, this one CHANGES HOW TWO TASKS ARE DONE, which is the test in
   section 10 - not size, but whether muscle memory now leads somewhere else:

   - **Truck fullness is now one entry per LOAD, not per truck.** A truck that
     runs the job twice gets two entries with its own fill estimate each, and the
     picker will offer the same truck again. Crews who learned "one row per
     truck" will get this wrong without being told.
   - **Admin no longer types initials** when marking a job reviewed. The three
     checkboxes remain; the reviewer is taken from the signed-in account.

   Draft patch note (no em dashes, per the company invariant):

   > **Timeline confirmations.** Logging an arrival, departure, start or finish
   > now shows a confirmation like "Departure at 3:00 PM added to timeline", so
   > you can see it landed without opening the Timeline.
   >
   > **Truck fullness: one entry per load.** If a truck runs the job twice, add
   > it twice and estimate each load separately. Loads are rarely packed the
   > same, and the second trip is usually lighter.
   >
   > **Bulletin photos are no longer cropped.** Tall photos used to lose their
   > top and bottom. They now fit whole.
   >
   > **Your hours, by week.** Tap a week in Worked Hours to see the jobs behind
   > it.
   >
   > **Office:** the employee roster is sorted by last name with inactive
   > accounts grouped at the end, works properly on a phone, and payroll is
   > sorted by last name too. Reimbursements can be approved or declined from
   > the payroll detail, and a declined claim emails the crew member the reason.

---

- **Fold `docs/DATA_FLOW_STAGING.md` into `docs/DATA_FLOW.md`.** Deferred at the
  v1.8 promotion, again on 2026-08-11, on 2026-08-12, and twice on 2026-08-13.
  **This is now five promotions old**, and the delta has grown to 900+ lines
  against a 576-line production ledger.

  It needs a session with the app RUNNING, not another reading pass. That is the
  whole reason it keeps slipping: the five payroll/time paths have to be traced
  device to Postgres into the actual Sheet before they can be folded in as `[x]`,
  and no amount of source review earns that mark.

  Why it is still here: the delta's "Reconciliation `7fe20a4` -> `7f41611`"
  section covers five data paths (Mountain-time recording, the two payroll
  finalize preconditions, per-entry entry dates, RODS driver-keying) that were
  verified by **reading the source and the diffs**, not by tracing a value from
  device to Postgres to Sheet. The doc's own legend says `[x]` means traced, so
  folding them in as `[x]` would assert a verification nobody performed. They are
  deliberately not marked `[ ]` either, since that asserts the opposite and is
  equally unearned.

  Why it does **not** block a merge: every commit that section describes is
  already on `main`, so this is documentation debt `main` already carries, not a
  new staging flow. Confirmed 2026-08-11 with `git merge-base --is-ancestor` on
  all ten referenced commits.

  To clear it: exercise those five paths end to end on a real device against
  prod, promote them to `[x]`, fold the delta in, empty it, and bump "Verified
  against". That needs a device and prod access, so it is the owner's to schedule
  or delegate, not something that can be closed from a checkout.
