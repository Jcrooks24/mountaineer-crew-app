# 0028 - Close-out reasons are multi-select and run in both directions

**Date:** 2026-07-28
**Status:** Accepted

## Context

The job-report close-out (ADR-less, shipped 2026-07-27) asked three questions:
why the job differed from the quote, how ready the client was, and what changed
on site. Two of the three were shaped wrong.

**It forced one answer where there were several.** `variance_cause` was
single-select, prompted as "Pick the biggest single reason". A day that ran four
hours long usually ran long because the client was not packed *and* the elevator
was not reserved *and* the volume was under-called. The crew picked one, and the
other two were gone. Same on the scope-change rows: one `kind` per row meant a
client dropping both their storage unit and their second stop had to be logged
as two separate "changes", inflating `scope_change_count` for what the crew
experienced as one conversation on the driveway.

**Both vocabularies only described a job going one way.** Every variance cause
was a reason the day ran LONG (`underestimated_volume`, `client_not_ready`,
`scope_added_on_site`). Every scope-change kind but one was an addition
(`added_items`, `extra_stop`, `packing_added`, `storage_added`,
`disposal_added`). A crew that finished a six-hour estimate in three and a half
hours had nothing honest to tap, so they tapped nothing, and the office could
not tell "no variance" from "we beat the estimate by 40%".

That second half matters more than it looks. An estimate that runs long costs
money and gets noticed. An estimate that runs short quietly overcharges the
client and never generates a complaint, so the only way the office learns its
estimates are high is if the crew can say so. The form could not.

## Decision

**Both close-out reason lists are multi-select, and both carry reduction-side
options.**

- `variance_cause` (string) becomes `variance_causes` (list). Five
  reduction-side keys join the list: `overestimated_volume`, `easier_access`,
  `client_ahead_of_prep`, `scope_reduced_on_site`,
  `crew_faster_than_expected`.
- A scope change's `kind` (string) becomes `kinds` (list), with six
  reduction-side keys: `fewer_items`, `stop_dropped`, `packing_not_needed`,
  `storage_not_needed`, `client_already_packed`,
  `less_volume_than_estimated`.
- Each scope change gains a `direction` of `added` or `saved`. `hours` stays a
  positive magnitude; `direction` carries the sign. A change can now report
  that it gave time back.
- `client_readiness` stays single-select. It is one ordinal answer about one
  moment, and "mostly ready AND not ready" is not a thing anybody means.

**The sheet's `scope_change_hours` column is now a NET signed sum**, additions
minus reductions, where it used to be a gross total of additions. The column
answers "how far did the day move from the quote", and only a signed sum
answers it.

**Old data is upgraded on read, never rewritten.**

- `ScopeChangeEntry` has a pre-validator that accepts the old `{kind, hours,
  note}` shape and lifts it to `{kinds: [kind], direction}`. Direction is
  inferred: `reduced_scope` (the one reduction key that existed) becomes
  `saved`, everything else `added`.
- The new `variance_causes_json` column is the write target. The original
  `variance_cause` string column is left in place, unbackfilled, and read as a
  fallback when the JSON column is null.
- The frontend mirrors both upgrades in `normalizeScopeChanges` /
  `normalizeVarianceCauses`, applied on every read path.

## Why not backfill and drop the old column

A backfill would have been a data migration over live job reports to retire one
nullable column. The fallback read costs a null check and cannot lose a row; the
migration could. Reports written in the ~24 hours the singular field existed are
few, but they are real close-outs and there is no upside to risking them.

The same reasoning covers `scope_changes_json` more strongly: it is an opaque
`Text` blob holding a list of dicts, so "migrating" it means parsing and
rewriting every report's JSON in a single transaction. Reading the old shape
costs one `if "kinds" not in data`. No migration touches it, and the two shapes
coexist in that column indefinitely, on purpose.

## Why the old singular fields are still accepted on the wire

`JobReportUpsert` still accepts `variance_cause` and folds it into
`variance_causes`. The app is a PWA on crew phones; a crew member who has not
refreshed past the service-worker prompt (ADR 0006) is running the old bundle
and posting the old field name. Rejecting it would not show them an error, it
would silently stop recording their close-out until they happened to reload.
The same reasoning covers `{kind}`-shaped scope changes arriving from that
build.

## Consequences

- Cause counts across reports can exceed the report count. Anything charting
  causes must count selections, not rows.
- The `variance_cause` sheet **column keeps its singular header** (a year of
  formulas point at it) and now holds a comma-joined list of labels. Only the
  cell contents changed.
- `scope_change_count` counts changes, not reasons. A row with three kinds is
  one change, which is the point.
- `reduced_scope` is no longer offered in the picker but stays in the valid
  vocabulary and keeps a label, because historical reports carry it.

## Do not undo

- Do not "simplify" `variance_causes` back to a single cause. Multi-cause is
  the normal case, not the edge case.
- Do not drop the legacy `kind` / `variance_cause` acceptance until every crew
  device has demonstrably taken the update. It is a few lines and it is the
  only thing standing between an unrefreshed phone and silently-lost close-outs.
- Do not make `hours` signed. The magnitude and the direction are separate
  fields precisely so they cannot disagree with each other.
