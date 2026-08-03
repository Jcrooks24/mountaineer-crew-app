"""Admin corrections to crew-reported payroll hours.

An override LAYER, not an edit. A correction row records "for this pay period,
this employee's hours from this source should read X, not Y" and leaves the
crew's original submission byte-for-byte untouched (ADR 0029). The payroll
summary applies corrections on top of the raw aggregate at read time.

Two things fall out of that which an in-place edit could not give:

  1. The original and the correction are both visible, so a disagreement about
     what somebody wrote down is settled by looking, not by remembering.
  2. The correction email writes itself. There is a before and an after on the
     same row, which is exactly what the crew member needs to be told.

`applies_to` identifies what is being corrected. It is deliberately a loose
(source, key) pair rather than a foreign key: the correctable sources live in
four different tables, one of them (job-report employee hours) is a JSON blob
with no row identity of its own, and a correction must survive the underlying
row being edited or deleted. A dangling correction is an admin's note about a
period, and losing it silently would be worse than keeping it.
"""

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)

from app.db.session import Base


# What kind of record a correction points at.
#   job        - one employee's hours row inside a job report's employee_hours_json
#   off_job    - an OffJobEntry
#   office     - an OfficeHoursEntry
#   manual     - no underlying record; an admin-added line for this period
#                (the "Lucas's 2.75 moving hours" note that lives in the sheet
#                margin today)
CORRECTION_SOURCES = ("job", "off_job", "office", "manual")

# Which bucket the corrected number lands in. Mirrors the payroll summary's
# buckets so a correction can move hours between them, not just change a total:
# "these 8 hours were non-billable, not billable" is the common real correction.
CORRECTION_BUCKETS = ("billable", "non_billable", "other", "per_diem_nights")


class PayrollCorrection(Base):
    __tablename__ = "payroll_corrections"

    id = Column(Integer, primary_key=True, index=True)

    # The pay period a NON-job correction belongs to (ISO YYYY-MM-DD, inclusive).
    # Off-job, office and manual corrections are still period-scoped: they have
    # no job to hang off, and finalizing a period must not re-mail corrections
    # from an older one. Job corrections leave these NULL (see job_uuid).
    period_start = Column(String, nullable=True, index=True)
    period_end = Column(String, nullable=True, index=True)

    # Set when this is a JOB-scoped correction (ADR 0032, amends 0029). A job
    # correction is made once, from the Job Summary, and flows into whichever
    # pay period contains the job's date - correct the job once, it is correct
    # everywhere. source stays "job" and source_key stays the job_uuid, so the
    # payroll summary's target matching is unchanged; job_uuid is what tells the
    # read path to pull it in by job rather than by period, and what the partial
    # unique index below keys on.
    job_uuid = Column(String, nullable=True, index=True)

    # Who the correction is about. user_id is the key; user_name is kept for
    # display and for the email, and so a correction stays readable if the
    # roster row is later deactivated.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_name = Column(String, nullable=False)

    # What is being corrected. See CORRECTION_SOURCES.
    source = Column(String(16), nullable=False)
    # job_uuid / entry_uuid for a correction to a real record. For `manual`
    # lines the router mints a UUID instead, because the uniqueness constraint
    # below is keyed on this: a shared empty string would let an admin add
    # exactly one manual line per bucket per employee per period, and a period
    # routinely needs several (a bonus AND a per-diem AND a contractor's hours).
    # Not a FK, on purpose - see the module docstring.
    source_key = Column(String, nullable=False, default="")
    # Human label for the source, captured at correction time so the email and
    # the audit view still read sensibly if the job is renamed later.
    source_label = Column(String, nullable=True)

    # The day the work happened (ISO YYYY-MM-DD), so a correction lands in the
    # right by-day column and the right OT week.
    work_date = Column(String, nullable=False, index=True)

    bucket = Column(String(20), nullable=False, default="billable")

    # What the crew reported, captured when the correction was made. Stored
    # rather than re-derived so the email says what the crew member actually
    # saw, even if the underlying row changes afterwards.
    original_hours = Column(Float, nullable=False, default=0.0)
    # What it should be. The two are hours for every bucket except
    # per_diem_nights, where they are a night count.
    corrected_hours = Column(Float, nullable=False, default=0.0)

    # Why. REQUIRED at the API layer - it is the body of the email the crew
    # member gets, and "your hours changed, no reason given" is worse than not
    # sending one.
    reason = Column(Text, nullable=False, default="")

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    # Set when the finalize step successfully mailed this correction to the
    # crew member. Null = not yet told. This is what makes finalize idempotent:
    # re-finalizing a period mails only what has not gone out, so an admin who
    # corrects one more thing after finalizing does not re-send the whole batch.
    notified_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        # One correction per (period, employee, source record, bucket) for the
        # period-scoped rows. A second correction to the same thing is an edit of
        # the first, not a new row - otherwise two half-corrections stack and the
        # total is wrong twice. Job rows have NULL periods, so Postgres treats
        # them as distinct here and this constraint never governs them.
        UniqueConstraint(
            "period_start",
            "period_end",
            "user_id",
            "source",
            "source_key",
            "bucket",
            name="uq_payroll_correction_target",
        ),
        # The same one-per-target rule for job-scoped rows, keyed on the job
        # instead of the period. Partial so it applies only where job_uuid is
        # set, leaving the period-scoped rows to the constraint above.
        Index(
            "uq_payroll_correction_job",
            "user_id",
            "job_uuid",
            "bucket",
            unique=True,
            postgresql_where=text("job_uuid IS NOT NULL"),
        ),
    )
