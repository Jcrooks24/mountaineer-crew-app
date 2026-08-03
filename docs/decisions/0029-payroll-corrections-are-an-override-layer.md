# 0029 - Payroll corrections are an override layer, and the app holds no pay rates

**Date:** 2026-07-28
**Status:** Accepted. Amended by [0032](0032-corrections-are-made-at-the-job.md), which
moves job-hour corrections from the pay period to the job and makes initialing
the notification trigger. The override-not-edit principle here is unchanged.

## Context

Payroll was assembled by hand. Every number an admin typed into QuickBooks came
out of a spreadsheet that was itself transcribed from what the app already
knew: per-employee hours on job reports, off-job entries, office hours,
long-distance per-diem nights, approved reimbursements. The app had all of it
and no way to show it as one page for a pay period.

Two things had to be decided before building that page.

**What happens when the crew got it wrong.** Crew fill in their own hours in the
field, and sometimes the number is wrong: a crew lead estimates somebody's end
time, a job gets logged non-billable that was billable, somebody forgets to
clock a break. Admin has to be able to fix it before payroll runs.

**Whether the app learns about money.** Producing "gross pay" would mean storing
an hourly rate per employee.

## Decision

### Corrections are an override layer, never an edit

A correction is a row in `payroll_corrections` saying "for this pay period, this
employee's hours from this source should read X, not Y, because Z". The
underlying `job_reports`, `off_job_entries` and `office_hours_entries` rows are
never touched. The payroll summary applies corrections on top of the raw
aggregate at read time.

This buys three things an in-place edit cannot:

1. **The crew's original submission survives.** A disagreement about what
   somebody wrote down is settled by looking at both numbers, not by
   remembering. The page shows "Corrected from 8: clocked out at 3:30".
2. **The notification email writes itself.** There is a before, an after, and a
   reason on one row. That is exactly what the crew member needs to be told,
   and it needs no diffing of anything.
3. **The sheet stays honest.** An in-place edit would silently re-export the job
   report with different hours and no trace of who changed them or why.

A correction REPLACES its target's contribution rather than adjusting it, so
correcting the same thing twice is an edit of the first correction, not two
adjustments stacking. The unique constraint on `(period, user, source,
source_key, bucket)` enforces that at the database level.

**Corrections are period-scoped.** The same job corrected in two different
periods is two corrections, and finalizing one period never re-mails the other.

**`source_key` is not a foreign key.** The four correctable sources live in
different tables, one of them (per-employee hours) is a JSON blob inside a job
report with no row identity of its own, and a correction must outlive the record
it points at. A correction whose job was deleted still shows up as its own line:
an admin's decision about a pay period must not evaporate because the underlying
record moved.

### The app stores no pay rates

The tool reports **hours per bucket, per-diem nights, and the dollar figures crew
entered themselves** (approved personally-paid expense reimbursements). It does
not compute gross pay, and there is no rate field on the roster.

Rates are the one piece of payroll data the app has never held. Adding them
would put every employee's compensation in a database that exists to be used on
phones in the field, in exchange for saving an admin a multiplication that
QuickBooks already does. Mileage is reported as **miles, not dollars**, for the
same reason: the IRS rate changes, and a stale hardcoded rate that silently
underpays is worse than a number the admin prices themselves.

### Overtime is computed after corrections, per Monday-anchored week

Over 40 billable hours in a Monday-to-Sunday week is OT. Non-billable and
"other" pay structures do not count toward the threshold, matching
`routers/hours.py`, so a crew member's Profile card and the admin payroll page
cannot disagree.

OT is recomputed **after** corrections are applied. A correction that moves six
hours out of billable can drop somebody under 40, and what is owed is the OT the
corrected numbers produce.

A period that does not start on a Monday and end on a Sunday has a week hanging
outside it, whose OT cannot be settled from that period alone. The page says so
rather than reporting a number that may be wrong in either direction.

### Finalize is idempotent and fails loudly

Finalizing mails each affected crew member one summary and stamps
`notified_at`. Corrections already sent are skipped, so an admin who corrects
one more thing afterwards re-runs finalize and only the new correction goes out.

Sends are per-employee and best-effort. One crew member's bad email address must
not stop the rest of the crew being told. A failed send does **not** get
stamped, so the next finalize retries it, and the failure is returned to the
page rather than swallowed.

Finalize also **refuses to run at all** when Postmark is unconfigured. The
shared mailer degrades to printing on stdout when the token is missing (that
fallback is what lets the backend boot without secrets), and it does not raise.
Without an up-front check, finalize would report every send as a success and
stamp `notified_at`, permanently marking crew as told about a correction that
went to a log file. That state is unrecoverable without editing the database, so
this one caller checks the config instead of trusting the mailer.

Editing a correction that already went out clears `notified_at`: the crew member
was told the old number and is owed the new one. Re-saving the same values does
not re-arm, so an idle save does not spam anybody.

## Consequences

- A reason is **required** on every correction, enforced in the schema. It is
  the body of the email; "your hours changed, no explanation given" is worse for
  trust than not telling them.
- Hours are validated non-negative. Hours move between buckets; they never go
  below nothing, and a negative would silently subtract from a week's OT.
- Tips are not allocated per employee anywhere in the app (they exist only as a
  bill line item), so the tool does not report them. They stay manual.
- Office hours are bucketed as non-billable, which is where they land on the
  payroll sheet today. An admin who disagrees for a given period moves them with
  a correction.
- A name on a job report that matches nobody on the roster is **reported as a
  warning**, not silently dropped. A dropped row is somebody not getting paid.
- Inactive users still appear if they worked in the period. Somebody who left
  mid-period still gets that period's paycheck.

## Do not undo

- **Do not add a rate field and compute gross pay** without deciding, on
  purpose, that the app should hold compensation data. The multiplication is not
  the expensive part.
- **Do not "simplify" corrections into edits of the job report.** The override
  layer is the entire reason the crew's original number survives and the email
  can be generated.
- **Do not make finalize mail everything every time.** `notified_at` is what
  stops a crew member being emailed the same correction on every re-run.
- **Do not stamp `notified_at` before the send succeeds.** That converts a
  transient Postmark failure into a crew member who is never told.
