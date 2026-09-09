# 0045 - A correction is scoped by period or by date, and the discriminator is the period, not the job

Date: 2026-09-09
Status: Accepted
Amends: [0032](0032-job-hours-are-corrected-at-the-job-summary.md)

## Context

A `payroll_corrections` row has always come in one of two scopes:

- **Period-scoped.** `period_start` / `period_end` are set. The row belongs to
  one pay period. Off-job, office and manual lines were all written this way.
- **Date-scoped.** The periods are NULL and the row is placed by its own
  `work_date`, so it lands in whichever period contains that day. ADR 0032
  introduced this for job hour corrections: correct the job once, and it is
  correct in every period that job could be paid in.

Date-scoping exists because **there is no pay-period table**. The payroll tool
takes an ad-hoc start and end. Nothing can look up "the period containing
2026-09-03", so a correction to a record that carries its own date cannot be
period-stamped when it is written. Its date has to do the placing.

Both read paths keyed that distinction on `job_uuid`:

```python
job_corrections    = ... .filter(PayrollCorrection.job_uuid.isnot(None), work_date between start, end)
period_corrections = ... .filter(PayrollCorrection.job_uuid.is_(None),   period_start == start, period_end == end)
```

That worked only because the two properties happened to coincide: the job
endpoint is the only thing that ever wrote a NULL period, and it always set a
`job_uuid` at the same time.

Giving off-job hours a correction surface (the office asked for one on
2026-09-09: they were the last logged thing an admin could not fix) broke the
coincidence. An off-job entry carries its own `work_date` and belongs to no job,
so it wants exactly the date-scoped behaviour and has no `job_uuid` to be
recognised by. Such a row fell into a gap:

- the summary read date-scoped rows by `job_uuid IS NOT NULL`, so it was never
  applied, and the employee was paid the uncorrected figure;
- worse, `finalize_period` mailed by `period_start == this period` and the job
  path mailed by `job_uuid`, so it was mailed by **nobody**. Pay would have
  changed and the employee would never have been told.

## Decision

**`period_start IS NULL` is the scope discriminator.** A correction with no
period is placed by its `work_date`; a correction with one is placed by that
period. `job_uuid` goes back to meaning only what it says - which job this is
about - and is no longer load-bearing for placement.

Concretely:

1. The summary read and the finalize mail query both key on `period_start`.
   They key on the **same rule**, so what a period pays and what it mails are
   one set. That equality is the property worth protecting; it is asserted in
   `frontend/scripts/verify_off_job_corrections.mjs`.
2. `finalize_period` still excludes `job_uuid IS NOT NULL`. Job corrections are
   mailed when the job is initialed (ADR 0032), and mailing them from both
   places would double-notify.
3. `uq_payroll_correction_dated` gives date-scoped non-job rows the same
   one-per-target rule the other two scopes have. Postgres-only: a partial
   index's `WHERE` is silently dropped on SQLite, where it would become a full
   unique index that also binds the period-scoped rows the clause exists to
   exclude.
4. Off-job corrections are date-scoped **whichever surface writes them**. The
   payroll screen's per-line editor drops its period filter for `source =
   "off_job"` and writes NULL periods. Without that, the two surfaces could each
   hold a row for the same entry, and finalize would mail both while paying one.

This changes nothing for existing rows. Job corrections have always nulled their
period (`upsert_job_correction` does it explicitly when migrating a legacy row),
and period corrections have always set one, so `period_start IS NULL` selects
exactly the set `job_uuid IS NOT NULL` did.

## Consequences

- A third kind of correctable record needs no read-path change. It carries a
  date, it writes NULL periods, and both queries already find it.
- A row with **neither** a period nor a date in range is now visible instead of
  silently inert. Previously such a row existed and was never applied; it is
  better for a correction to be applied than to sit in the table unread.
- The rule to hold on to when touching this code: **a correction that changes
  pay must be reachable by exactly one mailing path.** Zero is the dangerous
  case and is what this ADR exists to prevent; two is merely embarrassing.
- Recorded PTO is deliberately outside all of this. It pays into the `pto`
  bucket, which is not a correction bucket (it must never reach the overtime
  sum), and it draws down an allowance the PTO tool tracks. The off-job surface
  refuses it and says where to go instead.
