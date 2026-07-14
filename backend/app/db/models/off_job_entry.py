"""Off-job hours: work done outside of any job.

A rare, usually pre-approved edge case (e.g. shop work, errands). Captures the
timeline start/finish, the hours, a management-approved pay structure, and a
required "what you did" note. Keyed by a client-generated entry_uuid for
idempotent offline submission (mirrors incidents / reimbursements).
"""

from sqlalchemy import Column, DateTime, Float, Integer, String, Text
from app.db.session import Base


class OffJobEntry(Base):
    __tablename__ = "off_job_entries"

    id = Column(Integer, primary_key=True, index=True)

    # Client-generated UUID - idempotency key for the offline queue.
    entry_uuid = Column(String, unique=True, index=True, nullable=False)

    # Indexed: filtered on by the crew's own off-job list and by the
    # worked-hours query, both of which run per user on a growing table.
    submitted_by_id = Column(Integer, nullable=True, index=True)
    submitted_by_name = Column(String, nullable=True)

    # When the work happened (YYYY-MM-DD).
    work_date = Column(String, nullable=True)

    # Timeline action events (HH:MM, optional). hours is the reported total and
    # is the authoritative value; start/end are the captured timeline stamps.
    start_time = Column(String, nullable=True)
    end_time = Column(String, nullable=True)
    hours = Column(Float, nullable=False, default=0)

    # Management-approved pay structure: "regular" | "non_billable" | "other".
    pay_structure = Column(String, nullable=False, default="regular")
    # Free-text detail when pay_structure == "other".
    pay_other_note = Column(String, nullable=True)

    # Required "what you did".
    notes = Column(Text, nullable=False, default="")

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
