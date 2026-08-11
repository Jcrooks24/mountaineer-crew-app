# 0032. Hour corrections are made at the job, and initialing attests to it

**Status:** Active. Shipped 2026-08-03. Amends [0029](0029-payroll-corrections-are-an-override-layer.md).

## Context

ADR 0029 made admin corrections an override layer: a correction records "for
this pay period, this person's hours from this source read X, not Y" and never
edits the crew's submission. That principle is right and stays. But the ADR
scoped every correction to a **pay period** and made them **in the payroll
tool**, and both of those turned out to fight how the work is actually done:

- The admin validates hours **per job**, on the Job Summary, where the whole
  record is in front of them (events, DVIR, inventory, the crew's hours). The
  correction belonged there, not on a period grid that had lost the job context.
- Period-scoping meant the same job's hours could be re-judged in every period
  it touched, and a correction was divorced from the one thing it is about - the
  job.
- The crew member found out a change had been made to *their* hours only when a
  whole period was finalized, not when the job they worked was signed off.

Separately, the Job Summary already had an "entered" checkpoint: initials + a
date meaning "I typed this into the books". That was weaker than what the admin
actually needs to certify.

## Decision

**A correction is made once, at the job, and initialing the job is a
three-part attestation that fires the crew notification.**

- **Corrections are job-scoped.** A correction still keeps `source="job"` and
  `source_key=job_uuid` (so the payroll summary's target matching is unchanged),
  and now also carries a `job_uuid` scope marker with a null period. It is made
  from the Job Summary, and it flows into whichever pay period contains the
  job's date - correct the job once, it is correct everywhere. The override
  principle from 0029 is untouched: the crew's `employee_hours_json` is never
  edited, both numbers stay visible, and the Sheet still mirrors what the crew
  submitted (corrections live in the app, not the Sheet).
- **Payroll is read-only for job hours.** The payroll tool shows the corrected
  number with an "at Job Summary" marker and no edit control for `job` lines.
  Off-job, office and manual corrections stay period-scoped and editable there -
  they have no job to hang off.
- **Initialing is a three-part attestation.** On the Job Summary the admin
  affirms, all three required before initials record: *I reviewed this record*,
  *I made any needed corrections (or there were none)*, *I confirmed this job's
  data landed in the Google Sheet*. The Sheet confirmation is a manual check -
  the admin looks and ticks it - not an automated verification.
- **Initialing notifies the crew.** Saving the attestation mails each affected
  crew member exactly what changed on their hours for that job, then stamps the
  correction notified. It is idempotent (a correction mails once; re-initialing
  does not re-send) and best-effort (a bad address does not block the checkpoint
  or the other crew; mail trouble is reported, not raised). Period finalize in
  the payroll tool no longer touches job corrections - it would double-notify.

## Consequences

- **The correction lives where the judgement is made.** The admin corrects on
  the same screen they validate, and the crew member hears about it when their
  job is signed off, not a fortnight later at period close.
- **0029's guarantees still hold.** Override not edit; original and correction
  both visible; the email writes itself from the before/after/reason; the Sheet
  stays honest. This ADR moves *where* and *when*, not *whether* corrections
  touch crew data (they still do not).
- **Two notification paths, no overlap.** Job corrections notify at initialing;
  off-job/office/manual corrections notify at period finalize. `finalize` and the
  job notifier each filter to their own rows, so nobody is mailed twice.
- **Legacy period-scoped job corrections keep applying.** Any correction made
  under 0029 before this shipped (period-scoped, `job_uuid` null) is still read
  and applied; the read path dedupes it against a job-scoped row for the same
  target, and the first edit from the Job Summary migrates it in place. Do not
  delete the period-scoped read path or the dedupe until those are gone.
- **`admin_entry_status` rows created before this are backfilled attested.** A
  row exists only because an admin already signed off under the older meaning;
  forcing every historical job back to "unattested" would be noise, not safety.
- **Do not re-add hour editing to the payroll tool for `job` lines**, and do not
  re-scope job corrections to the period. Both are the mistake this ADR corrects.
