# Bug ledger

[BUG_LEDGER.csv](BUG_LEDGER.csv) holds one row per defect (559 as of 2026-09-24) this app has ever had, on
`main` (production, crews' phones) or on `staging`. It exists to answer four
questions, in the owner's words (intake 2026-09-24):

1. Is quality improving?
2. Where do bugs cluster?
3. What does a bug cost the field (how long it was live, how bad)?
4. How is bug frequency trending over time?

`python scripts/bug_ledger_summary.py` prints the tables below from the CSV. Add
`--live-era` to leave out the pre-staging rows.

## The two variables the owner asked for

**`detection`** has three values: how the defect was first noticed.

| value | means |
|---|---|
| `vet` | caught by the `/vet` pre-promotion pass ([VETTING_PROTOCOL.md](../VETTING_PROTOCOL.md), in use from 2026-07-01) |
| `user-reported` | a person hit it while using the app: crew in the field, admin, **or the owner testing staging** |
| `other` | everything else: `/sanity`, found while building or in review, found by an audit script, or nobody recorded how |

The owner chose a three-way split over a strict binary, and chose to count their
own staging testing as user-reported (intake 2026-09-24). `detection_method` keeps
the fine-grained value (`vet`, `sanity`, `crew-reported`,
`admin-or-owner-reported`, `dev-self-found`, `unknown`), so a different
collapse is always possible.

**`environment`**: `prod` if the defect was live on `main` before its fix reached
`main`. `staging` if the defect and its fix reached `main` in the same merge, or
the defect never reached `main`. `unknown` if the introducing commit could not be
identified. `environment_basis` says how each call was made.

## Columns

| column | meaning |
|---|---|
| `id` | `BUG-NNNN`, in `incident_date` order. Stable: new rows append the next number. |
| `incident_date` | the date used for trends: `detected_date`, else `fix_date`, else `introduced_date` |
| `area` | fixed vocabulary: rods-eld, dvir, bol, payroll-hours, job-report, timeline-events, offline-sync, sheets-export, drive-upload, auth, estimator, inventory, photos-incidents, availability, admin-ui, crew-ui, notifications-email, dq-docs, perf-oom, deploy-infra, other |
| `severity` | data-loss, wrong-data, blocked-workflow, degraded, cosmetic, perf |
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
| `env_confidence` | how sure the `environment` call is (`med`/`low` = inferred by git blame) |
| `source` | where it was found: commit, postmortem, runbook, adr, sanity, patch-notes, promotion-checklist, data-flow, other-doc |

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

A second check then re-read every row that was low-confidence or had an unknown
environment (144 rows) against git: is it really a defect, is the environment
right, is the detection right. Those rows carry `env_confidence=checked`. It moved
47 environment calls (most unknown to prod, by confirming the defective code is on
`main` today), corrected 7 detection calls, and removed the 12 rows below. The
other 427 rows were not re-read.

- `detection=other` is large because most commit messages do not say who found a
  bug. Treat it as "not recorded as vet or user-found", not as "found internally".
- 4 rows remain `environment=unknown`: process or shared-resource problems (an env
  var, the Apps Script runtime, a CI mirror) that belong to neither branch.

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
Compare like with like: prod defects per promotion, or the `user-reported` share,
are sturdier than raw monthly totals.

## Snapshot, staging-first era (2026-04-18 on, 488 rows)

| environment | vet | user-reported | other | total |
|---|---|---|---|---|
| prod | 30 | 52 | 170 | 252 |
| staging | 74 | 32 | 126 | 232 |
| unknown | 0 | 0 | 4 | 4 |

| month | prod | staging | unknown | vet | user-reported | other | total |
|---|---|---|---|---|---|---|---|
| 2026-04 | 17 | 24 | 0 | 0 | 2 | 39 | 41 |
| 2026-05 | 26 | 7 | 0 | 0 | 5 | 28 | 33 |
| 2026-06 | 12 | 15 | 0 | 0 | 5 | 22 | 27 |
| 2026-07 | 59 | 94 | 2 | 47 | 18 | 90 | 155 |
| 2026-08 | 80 | 52 | 2 | 34 | 33 | 67 | 134 |
| 2026-09 | 58 | 40 | 0 | 23 | 21 | 54 | 98 |

Prod defects cluster in sheets-export (49), job-report (28), crew-ui (24),
offline-sync (17), payroll-hours (15), bol (15) and rods-eld (14). By severity:
wrong-data 72, degraded 60, data-loss 40, cosmetic 33, blocked-workflow 30, perf 17.
A fixed prod defect was live a median of 35 days (mean 48.4, max 175, n=159)
before its fix reached `main`.

## Keeping it current

When a commit fixes a defect, add a row in the same commit (Definition of done,
item 5 in [CLAUDE.md](../../CLAUDE.md)). Take the next `BUG-NNNN`, fill what is
known, and leave a field empty rather than guess. When a Known defects entry in
RUNBOOKS.md is deleted because it was fixed, its ledger row gets its fix columns
and `status=fixed`.
