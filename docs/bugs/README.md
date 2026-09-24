# Bug ledger

[BUG_LEDGER.csv](BUG_LEDGER.csv) holds one row per defect (563 as of 2026-09-24) this
app has ever had, on `main` (production, crews' phones) or on `staging`. Two files
beside it let bug counts be read against how big the app is:
[APP_SIZE.csv](APP_SIZE.csv) (lines of code and lines changed, per branch per month)
and [FEATURES.csv](FEATURES.csv) (every feature, dated; the definition is in
[FEATURES.md](FEATURES.md)).

They exist to answer four questions, in the owner's words (intake 2026-09-24):

1. Is quality improving?
2. Where do bugs cluster?
3. What does a bug cost the field (how long it was live, how bad)?
4. How is bug frequency trending over time?

And, from the second intake the same day: "account for # of lines of code over
time and # of features, so that the bug frequency can be related to the actual
size of the app."

| command | does |
|---|---|
| `python scripts/bug_ledger_summary.py` | prints every table below. `--live-era` leaves out the pre-staging rows. |
| `python scripts/bug_ledger_size.py` | regenerates APP_SIZE.csv from git |

## The two variables the owner asked for

**`detection`** has four values: how the defect was first noticed.

| value | means |
|---|---|
| `vet` | caught by the `/vet` pre-promotion pass ([VETTING_PROTOCOL.md](../VETTING_PROTOCOL.md), in use from 2026-07-01) |
| `field-reported` | a crew member or office staff hit it doing real work. Includes reports the owner typed in on their behalf ("Crew reported bug: ...") |
| `owner-reported` | the owner found it: testing staging, using the app, reviewing the Sheet Backfill page, or through the in-app bug tool in their own name |
| `other` | everything else: `/sanity`, found while building or in review, found by an audit script, or nobody recorded how |

**Owner rulings, 2026-09-24.** The first intake split detection three ways and
counted the owner's own reports as user-reported. The second intake split that
value in two, because "sometimes I use the bug reporting feature to report bugs,
so bugs reported by me shouldn't be considered field-reported." Also ruled: a
crew report the owner relays is field-reported; unnamed "reported as ..." rows
are owner-reported; the Sheet Backfill defects are owner-reported, since nobody
else uses that page. `reporter` (crew / office-admin / owner) and
`reporter_basis` record who and why for every reported row, and
`detection_method` keeps the fine-grained value (`vet`, `sanity`,
`crew-reported`, `office-admin-reported`, `owner-reported`, `dev-self-found`,
`unknown`).

**`environment`**: `prod` if the defect was live on `main` before its fix reached
`main`. `staging` if the defect and its fix reached `main` in the same merge, or
the defect never reached `main`. `unknown` if that could not be decided.
`environment_basis` says how each call was made.

## Columns

| column | meaning |
|---|---|
| `id` | `BUG-NNNN`. Stable: new rows take the next number above the highest ever used, retired numbers included. |
| `incident_date` | the date used for trends: `detected_date`, else `fix_date`, else `introduced_date` |
| `area` | fixed vocabulary: rods-eld, dvir, bol, payroll-hours, job-report, timeline-events, offline-sync, sheets-export, drive-upload, auth, estimator, inventory, photos-incidents, availability, admin-ui, crew-ui, notifications-email, dq-docs, perf-oom, deploy-infra, other |
| `severity` | data-loss, wrong-data, blocked-workflow, degraded, cosmetic, perf |
| `reporter` / `reporter_basis` | crew, office-admin or owner, and the quote or Bugs-tab entry that settles it (reported rows only) |
| `detection_evidence` | the quote that justifies `detection_method`. Empty means `unknown`. |
| `era` | `pre-staging` before 2026-04-18, when every commit went straight to `main`; `staging-first` after |
| `status` | fixed, open, wontfix |
| `introduced_sha` / `_date` | the commit that introduced the defect, where it could be identified |
| `prod_exposure_start` | the date the introducing commit reached `main` (prod rows only) |
| `fix_shas` / `fix_date` | the fixing commits, and the first one's authored date |
| `fix_reached_main_date` | when the fix reached `main` |
| `fix_path` | hotfix, promotion, direct-to-main, staging-only-fix, on-staging-not-yet-promoted, unfixed |
| `days_live_in_prod` | `fix_reached_main_date` minus `prod_exposure_start` |
| `confidence` | how sure the extraction was that this is a real, distinct defect |
| `env_confidence` | how sure the `environment` call is (`med`/`low` = inferred by git blame, `checked` = re-read against git) |
| `source` | where it was found: commit, postmortem, runbook, adr, sanity, patch-notes, promotion-checklist, data-flow, other-doc, bugs-tab |

## Size and features

**APP_SIZE.csv**, one row per branch per month. `loc` counts app source lines
(backend/app, frontend/src, apps_script; no tests, migrations or caches) at the
month-end commit. `lines_added`/`lines_removed` is churn: for `main`, what
reached production that month; for `staging`, all development work written that
month. Prod bugs are read against `main`, staging bugs against `staging`.

**FEATURES.csv**, one row per feature, with the day it reached staging and the day
it reached `main`, and a removal date if it was pulled. A feature is a distinct
tool or surface one user class uses to do one job, at the grain of the items the
PRD lists inside each capability (for example, "off-job, office, availability, LD
workday" are four features under one capability). Anything smaller is an
enhancement. That definition was inferred from [PRD.md](../PRD.md) and then
applied to the patch notes, as the owner asked; [FEATURES.md](FEATURES.md) has
the reasoning and every borderline call. 55 features, 54 live.

## How the ledger was built (2026-09-24)

Seventeen readers went through every commit on `main` and `staging` (769 commits,
2026-02-17 to 2026-09-23), [VET_POSTMORTEM_2026-08.md](../VET_POSTMORTEM_2026-08.md),
[RUNBOOKS.md](../RUNBOOKS.md) including every Known defects entry ever deleted from
its history, the ADRs, `docs/sanity/`, the patch notes, and the DATA_FLOW
deviations. 817 raw rows were clustered into 571 distinct defects.

`environment` and the dates then came from git, not from the readers: the date each
commit reached `main` was computed from the first-parent merge history, and where no
introducing commit was named, `git blame` on the lines each fix removed picked the
most likely one (`env_confidence` med or low).

A second check re-read every row that was low-confidence or had an unknown
environment (144 rows) against git. It moved 47 environment calls, corrected 7
detection calls, and removed the 12 rows listed below. A third pass re-read every
user-reported row (84) to name the reporter, matched against the 15 reports in
the production Sheet's Bugs tab (14 submitted by the owner, 1 by a crew member),
and added the 3 Bugs-tab reports that had no row (BUG-0572 to 0574). BUG-0575 was added by another session the same day. The
other rows were not re-read.

- `detection=other` is large because most commit messages do not say who found a
  bug. Treat it as "not recorded as vet or reported", not as "found internally".
- 4 rows remain `environment=unknown`: process or shared-resource problems (an env
  var, the Apps Script runtime, a CI mirror) that belong to neither branch.
- 7 rows are `field-reported` on `staging`. Crews run `main`, so either a named
  crew member was testing staging, or the environment call is wrong. Worth a look
  when those rows matter.

### Retired IDs

These were removed as not being defects. Their numbers are not reused.

- `BUG-0060` iOS photo input forced camera, no library option: capture=environment was set in the initial commit as a deliberate design choice, so removing it later to add a photo-library option is a preference change, not a defect fix.
- `BUG-0264` Patch notes admin tab labeled Notes, unfindable: The admin patch-notes tab was correctly functional, just labeled plain 'Notes' making it hard to find; this is a naming/discoverability improvement, not the software behaving incorrectly.
- `BUG-0317` Payroll excludes hours for unmatched roster names: RUNBOOKS.md states the exclusion of unmatched-name hours from payroll totals is deliberate, to avoid inventing a match and paying the wrong person, so this is a documented design tradeoff rather than software behaving contrary to its intent.
- `BUG-0364` Photo upload returned 200 ok:false on failure: The vet flagged /api/photos/upload returning HTTP 200 with {ok:false} on failure, but the fix commit itself confirms no photos were ever dropped since every client already checked !ok and kept the photo queued; the change only made failures visible to server-side metrics, an observability improvement rather than a behavior defect.
- `BUG-0365` Prod SHEETS_*_TAB env vars camelCase mismatch: The SHEETS_*_TAB env vars are spelled differently than the code's PascalCase defaults but correctly point at the real live tabs, so nothing is functionally broken; the team documented reality rather than risking a live rename.
- `BUG-0371` Availability cannot be submitted offline: The commit that logged this explicitly says availability has no offline path 'By design'; it is an acknowledged feature gap crews may mistake for a bug, not software behaving incorrectly.
- `BUG-0393` ADR numbering collision between staging and main: This is a documentation/process problem, staging and main independently numbered two ADR decision files identically, not software behaving wrong for a user.
- `BUG-0464` Raw NUL byte made nightly script binary to git: A raw NUL byte only made git treat the nightly script as binary and hide diffs; it did not change the script's behavior toward users, so this is a dev-tooling hygiene item rather than a functional software defect.
- `BUG-0473` Archived employees suspected in admin month view: RUNBOOKS states this does not reproduce by reading: MonthScheduleView already filters on is_active on every render path and there is no archive concept in the repo, so the suspicion was not confirmed as a real defect.
- `BUG-0550` Locked days faded undermine colorblind fills: The 55% opacity on locked availability cells was raised as a colorblind-accessibility finding, but the owner ruled it declined polish rather than a functional defect.
- `BUG-0570` Unregistered truck cannot have a DVIR filed: The compliance reference explicitly closed this as accepted by design, with a supported workaround (rental placeholder plus per-job plate), so this is a documented design limitation, not a defect.
- `BUG-0571` Skipped promotion steps caused post-promotion incidents: ADR 0001/0004 describe a manual-process risk inherent to the staging-first promotion checklist (a user-migration script and env-var check that must not be skipped), not the software behaving incorrectly on its own, and there is no fix commit.

## Read the trend with this in mind

**The ledger measures recorded bugs, not bugs.** Commit messages became far more
detailed from July 2026, the vet pass started 2026-07-01, and the sanity pass
started 2026-09-09. A rise from June to July is at least partly better record
keeping. September is a partial month (to 2026-09-23). Open defects count in the
month they were first recorded, so recent months also carry the open backlog.

**Rates beat counts, and size beats churn for a single month.** Bugs are recorded
in the month they were noticed, but they come from code written earlier, so a
month with little new code (September) shows a high per-churn rate from bugs in
older code. Per-KLOC and per-feature rates are steadier. Read three months
together, not one.

## Snapshot, staging-first era (2026-04-18 on, 492 rows)

| environment | vet | field-reported | owner-reported | other | total |
|---|---|---|---|---|---|
| prod | 30 | 31 | 24 | 170 | 255 |
| staging | 74 | 7 | 25 | 127 | 233 |
| unknown | 0 | 0 | 0 | 4 | 4 |

| month | prod | staging | unknown | vet | field-reported | owner-reported | other | total |
|---|---|---|---|---|---|---|---|---|
| 2026-04 | 17 | 24 | 0 | 0 | 2 | 0 | 39 | 41 |
| 2026-05 | 26 | 7 | 0 | 0 | 3 | 2 | 28 | 33 |
| 2026-06 | 12 | 15 | 0 | 0 | 0 | 5 | 22 | 27 |
| 2026-07 | 59 | 94 | 2 | 47 | 9 | 9 | 90 | 155 |
| 2026-08 | 80 | 52 | 2 | 34 | 11 | 22 | 67 | 134 |
| 2026-09 | 61 | 41 | 0 | 23 | 13 | 11 | 55 | 102 |

Against size (prod bugs vs `main`, staging bugs vs `staging`; churn = lines added + removed):

| month | main loc | prod bugs | per kloc | per k churned | features on main | per feature | staging bugs | per k churned | per feature |
|---|---|---|---|---|---|---|---|---|---|
| 2026-04 | 17,546 | 17 | 0.97 | 1.29 | 20 | 0.85 | 24 | 1.36 | 1.20 |
| 2026-05 | 26,997 | 26 | 0.96 | 2.28 | 23 | 1.13 | 7 | 0.47 | 0.30 |
| 2026-06 | 34,081 | 12 | 0.35 | 1.58 | 27 | 0.44 | 15 | 1.61 | 0.56 |
| 2026-07 | 53,033 | 59 | 1.11 | 2.44 | 40 | 1.48 | 94 | 2.27 | 2.19 |
| 2026-08 | 75,793 | 80 | 1.06 | 2.83 | 49 | 1.63 | 52 | 2.22 | 1.06 |
| 2026-09 | 81,963 | 61 | 0.74 | 7.36 | 54 | 1.13 | 41 | 3.61 | 0.76 |

Prod defects cluster in sheets-export (49), job-report (28), crew-ui (24),
payroll-hours (18), offline-sync (17), bol (15) and rods-eld (14). By severity:
wrong-data 73, degraded 61, data-loss 40, cosmetic 33, blocked-workflow 31, perf 17.
A fixed prod defect was live a median of 32.5 days (mean 48.3, max 175, n=160)
before its fix reached `main`.

## Keeping it current

When a commit fixes a defect, add a row in the same commit (Definition of done,
item 5 in [CLAUDE.md](../../CLAUDE.md)). Take the next `BUG-NNNN`, fill what is
known, name the reporter when a person reported it, and leave a field empty rather
than guess. When a Known defects entry in RUNBOOKS.md is deleted because it was
fixed, its ledger row gets its fix columns and `status=fixed`. When a feature
reaches `main`, add its FEATURES.csv row. Rerun `bug_ledger_size.py` before
reading a new month.
