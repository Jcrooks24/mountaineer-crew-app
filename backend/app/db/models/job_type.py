"""
JobType model.

Admin-managed list of job-type tags shown on the Job Report ("Job type"
multi-select) and used to decide which skills are relevant to rate on a given
job. Previously a hardcoded list mirrored in the frontend and the job_report
schema validator; now admin-configurable from the Settings tab.
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from app.db.session import Base


class JobType(Base):
    __tablename__ = "job_types"

    id = Column(Integer, primary_key=True, index=True)

    # Display name / tag. Unique so admin can't duplicate.
    name = Column(String(64), unique=True, nullable=False)

    # Manual ordering for the Settings list and the report chips.
    sort_order = Column(Integer, nullable=False, default=0)

    # Soft-disable a type without deleting it (keeps history intact on old
    # reports that still reference the tag). Inactive types don't render as
    # choices on new reports.
    active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
