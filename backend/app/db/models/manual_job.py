from sqlalchemy import Column, String, Date, DateTime, UniqueConstraint
from sqlalchemy.sql import func

from app.db.session import Base


class ManualJob(Base):
    """Manual job entries — jobs the crew types into the "Other (enter
    manually)" option on the Timeline. Persisted so the entry shows up in
    other crew members' dropdowns for the same day and so the same manual
    name resolves to the same job_uuid across devices.

    The client derives job_uuid deterministically from (normalized name,
    date) via a shared FNV hash — but we still store the mapping here so
    the dropdown can list what other devices have added for a given day.
    """

    __tablename__ = "manual_jobs"

    # Deterministic UUID derived on the client from name + date. Primary key
    # so a race between two devices with the same name/date collapses to a
    # single row (ON CONFLICT DO NOTHING).
    job_uuid = Column(String, primary_key=True, index=True)

    # Free-form job description as the crew typed it. Stored raw to preserve
    # capitalization; the natural key is (lower(name), job_date).
    name = Column(String, nullable=False)

    # The calendar date this manual job applies to (YYYY-MM-DD).
    job_date = Column(Date, nullable=False, index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Same normalized name + date must not appear twice. The client derives
    # a deterministic job_uuid from this pair, so the PK covers the race,
    # but the constraint documents intent for anyone reading the schema.
    __table_args__ = (
        UniqueConstraint("name", "job_date", name="uq_manual_jobs_name_date"),
    )
