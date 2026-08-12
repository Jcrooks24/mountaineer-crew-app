# 0037. The job-review attestation identifies the reviewer by account, not by typed initials

**Status:** Active (2026-08-12). Supersedes the initials half of
[ADR 0032](0032-job-hour-corrections-live-on-the-job-summary.md); the three-part
attestation itself is unchanged.

## Context

ADR 0032 made admin sign-off on a job a **three-part attestation** rather than a
single "done" tick:

- `validated` - I reviewed this job's record.
- `corrected` - I made any needed hour corrections, or there were none.
- `confirmed_in_sheet` - I confirmed the row landed in the Google Sheet.

alongside a free-text `entered_by` field for the admin's initials, on the
reasoning that initials are the signature on that statement.

In use, the initials turned out to add a step without adding information. The
owner's report was blunt: "admin initials on entry plus 3 checkboxes is a little
excessive for confirming a job report."

The substantive problem is that the initials were **weaker evidence than what the
request already carried**. `PUT /api/admin/job-entry-status/{job_uuid}` is
authenticated and admin-gated. The server already knows exactly who is making the
claim. A free-text box beside it can hold anything the person types, including
somebody else's initials, and nothing checks it. So the field was:

- not an identity check (the account already is one),
- not a second factor (same request, same session),
- and one more thing to type on a screen an admin visits for every job.

## Decision

**The reviewer is taken from the authenticated account.** `entered_by` is filled
server-side with the admin's name (falling back to their email), and the field is
optional in the request body.

**The three checkboxes stay, and all three are still required.** They are the part
that carries meaning: each is a distinct claim about the record, and an admin can
truthfully affirm one and not another. Nothing here weakens the attestation - it
changes only how the person behind it is identified, from two typed letters to
the account that made the request.

`entered_by` is still accepted when sent, for two reasons:

1. An older client that still posts initials keeps working.
2. The payroll report waiver writes the literal string `(waived)` into that
   column, so a waived job is never mistaken for a job a person reviewed. That
   distinction would be lost if the field were always overwritten with a name.

## Consequences

- Existing rows keep whatever initials were typed at the time. Nothing is
  backfilled or rewritten: those are a true record of what was entered, and
  replacing them with a name derived from `updated_by_id` would be inventing
  history that was not recorded that way.
- The `entered_by` column consequently holds a **mix**: typed initials on older
  rows, full names on newer ones, and `(waived)` on waived jobs. Anything reading
  that column (including the Sheet) must treat it as free text, which it always
  was.
- The Sheet's `entered_by` column will start showing full names. That is more
  legible to the office than initials, but it is a visible change to a column
  people already read.
- Losing the typed field means an admin can no longer record that somebody
  *else* reviewed the job. Accepted: that was never verifiable anyway, and doing
  it properly would mean a real "reviewed on behalf of" field rather than an
  honour-system text box.

## Alternatives considered

**Keep the initials.** Rejected: they were the redundant half. The account is a
stronger claim about identity than the box.

**Drop the checkboxes and keep the initials.** Rejected outright - backwards.
The checkboxes are the specific claims; the initials were only the signature on
them. Dropping them would turn a three-part attestation back into an unexamined
"done" tick, which is what ADR 0032 existed to replace.

**Drop initials only where admin is the reviewer, keep them crew-facing.** There
is no crew-facing use of this field, so there was nothing to keep.
