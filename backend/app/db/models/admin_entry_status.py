"""
AdminEntryStatus model.

Tracks admin "I've reviewed and entered this job's data into our books"
checkpoints. One row per job_uuid; updated when admin saves their initials
and the date on the Job Summary view.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
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

    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by_name = Column(String, nullable=True)
    updated_at = Column(DateTime, nullable=False)
