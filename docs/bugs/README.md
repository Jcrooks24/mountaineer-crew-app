# Bug ledger

[BUG_LEDGER.csv](BUG_LEDGER.csv) holds one row per defect this app has ever had, on
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

## How the first 571 rows were built (2026-09-24)

Seventeen readers went through every commit on `main` and `staging` (769 commits,
2026-02-17 to 2026-09-23), [VET_POSTMORTEM_2026-08.md](../VET_POSTMORTEM_2026-08.md),
[RUNBOOKS.md](../RUNBOOKS.md) including every Known defects entry ever deleted from
its history, the ADRs, `docs/sanity/`, the patch notes, and the DATA_FLOW
deviations. 817 raw rows were clustered into 571 distinct defects.

`environment` and the dates then came from git, not from the readers: the date each
commit reached `main` was computed from the first-parent merge history. Where no
introducing commit was named, `git blame` on the lines each fix removed picked the
most likely one (`env_confidence` med or low). The planned second-opinion check of
every row (is it really a defect, is the detection right) was **not run**, to stay
within budget. So:

- **116 rows are `confidence=low`.** Some will turn out to be features or
  requirement changes described as fixes. Filter them out when a number matters.
- **54 rows are `environment=unknown`**, mostly open defects and fixes with no
  removed lines to blame.
- `detection=other` is large (382) because most commit messages do not say who
  found a bug. Treat it as "not recorded as vet or user-found", not as "found
  internally".

## Read the trend with this in mind

**The ledger measures recorded bugs, not bugs.** Commit messages became far more
detailed from July 2026, the vet pass started 2026-07-01, and the sanity pass
started 2026-09-09. A rise from June to July is at least partly better record
keeping. September is a partial month (to 2026-09-23). Compare like with like:
prod defects per promotion, or the `user-reported` share, are sturdier than raw
monthly totals.

## Snapshot, staging-first era (2026-04-18 on, 499 rows)

| environment | vet | user-reported | other | total |
|---|---|---|---|---|
| prod | 26 | 50 | 138 | 214 |
| staging | 74 | 31 | 126 | 231 |
| unknown | 5 | 3 | 46 | 54 |

| month | prod | staging | unknown | vet | user-reported | other | total |
|---|---|---|---|---|---|---|---|
| 2026-04 | 17 | 24 | 0 | 0 | 2 | 39 | 41 |
| 2026-05 | 25 | 7 | 1 | 0 | 5 | 28 | 33 |
| 2026-06 | 10 | 15 | 2 | 0 | 5 | 22 | 27 |
| 2026-07 | 54 | 93 | 10 | 47 | 18 | 92 | 157 |
| 2026-08 | 69 | 53 | 17 | 35 | 33 | 71 | 139 |
| 2026-09 | 39 | 39 | 23 | 23 | 21 | 57 | 101 |

Prod defects cluster in sheets-export (37), job-report (28), crew-ui (22),
offline-sync (15), bol (14) and perf-oom (13). By severity: wrong-data 61,
degraded 50, data-loss 35, blocked-workflow 27, cosmetic 24, perf 17. A prod
defect was live a median of 35 days (mean 48.7, max 175, n=162) before its fix
reached `main`.

## Keeping it current

When a commit fixes a defect, add a row in the same commit (Definition of done,
item 5 in [CLAUDE.md](../../CLAUDE.md)). Take the next `BUG-NNNN`, fill what is
known, and leave a field empty rather than guess. When a Known defects entry in
RUNBOOKS.md is deleted because it was fixed, its ledger row gets its fix columns
and `status=fixed`.
