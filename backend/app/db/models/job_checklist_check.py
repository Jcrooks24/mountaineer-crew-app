"""
JobChecklistCheck model (C3.2).

The tick state for MANUAL checklist items, per job. Auto items are not stored
here - they are computed live from the job's artifacts (a DVIR row exists, the
report is saved, etc.). One row per (job_uuid, item_key); keyed by the item's
stable config key so a checklist edit that reorders items does not lose ticks.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Integer,
    String,
    UniqueConstraint,
)
from app.db.session import Base


class JobChecklistCheck(Base):
    __tablename__ = "job_checklist_checks"

    id = Column(Integer, primary_key=True, index=True)
    job_uuid = Column(String, index=True, nullable=False)
    # The checklist item's stable config key (core/job_checklists.py).
    item_key = Column(String, nullable=False)
    checked = Column(Boolean, nullable=False, default=False)

    checked_by_id = Column(Integer, nullable=True)
    checked_by_name = Column(String, nullable=True)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("job_uuid", "item_key", name="uq_job_checklist_check"),
    )
