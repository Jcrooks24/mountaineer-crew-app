"""
AdminEntryStatus model.

Tracks the admin's per-job sign-off. Under ADR 0032 the initials are a
three-part attestation, not just "I typed this into a spreadsheet":

  validated           I reviewed this job's record.
  corrected           I made any needed hour corrections (or there were none).
  confirmed_in_sheet  I confirmed the row landed in the Google Sheet.

One row per job_uuid; updated when the admin saves on the Job Summary view.
Saving is what fires the per-job correction emails to affected crew.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from app.db.session import Base


class AdminEntryStatus(Base):
    __tablename__ = "admin_entry_status"

    id = Column(Integer, primary_key=True, index=True)
    job_uuid = Column(String, unique=True, index=True, nullable=False)

    # Free-text initials (no length cap - short strings are typical but the
    # form accepts anything the admin wants to record).
    entered_by = Column(String, nullable=False)
    # ISO YYYY-MM-DD; stored as Text so it round-trips into the sheet column
    # untouched (no naive→aware datetime conversions).
    entered_on = Column(String, nullable=False)

    # The three-part attestation (ADR 0032). Nullable in the column for the
    # migration backfill; the API requires all three true before it will record
    # initials, so a live row always has them set.
    validated = Column(Boolean, nullable=True)
    corrected = Column(Boolean, nullable=True)
    confirmed_in_sheet = Column(Boolean, nullable=True)

    # Payroll report waiver. Some jobs legitimately never get a job report - the
    # off-job hours a crew member logged against a manual job, an unpaid drive
    # leg - and the finalize gate would otherwise block payroll forever waiting
    # for a report nobody is going to file. An admin waives the requirement for
    # that specific job, with a reason, and it drops out of the gate.
    #
    # Deliberately per-job and explicit rather than a blanket setting: the gate
    # exists to stop payroll running on unreviewed work, and a global off switch
    # would retire the gate instead of handling the exception.
    report_waived = Column(Boolean, nullable=True, default=False)
    report_waived_reason = Column(String, nullable=True)
    report_waived_by_name = Column(String, nullable=True)
    report_waived_at = Column(DateTime, nullable=True)

    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_name = Column(String, nullable=True)
    updated_at = Column(DateTime, nullable=False)
