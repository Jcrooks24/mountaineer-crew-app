"""
Event model.
Represents a timestamped workflow event (optionally geotagged) for a job.
Offline-first: clients can batch-upload these later.
"""

from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, ForeignKey
from app.db.session import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)

    # UUID generated on device; used for idempotent inserts on sync
    event_id = Column(String, unique=True, index=True, nullable=False)

    # Offline-first: device-generated job UUID (primary linkage)
    job_uuid = Column(String, index=True, nullable=True)

    # Optional server-side FK if/when a Job row exists
    job_id = Column(Integer, ForeignKey("jobs.id"), index=True, nullable=True)

    # e.g. ARRIVED / START / FINISH / NOTE
    type = Column(String, index=True, nullable=False)

    # User-editable event time. Drives chronological sort on the timeline.
    # Defaults to `logged_at` on insert; crew can correct it via the timeline
    # UI (e.g. when an event is logged after the fact). Sheet writes use this
    # value in the `timestamp` column.
    timestamp = Column(DateTime, nullable=False)

    # Immutable record of when the device actually captured the event. Set
    # from the client's device time at insert and never updated thereafter -
    # this is the audit trail admins use to spot back-dated entries.
    logged_at = Column(DateTime, nullable=False)

    # Optional geotag captured only at event time
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    accuracy_m = Column(Float, nullable=True)

    # Human-readable job name (client name) passed from frontend localStorage
    job_name = Column(String, nullable=True)

    # Who logged this event (user name or email)
    created_by = Column(String, nullable=True)

    # Optional free text
    note = Column(String, nullable=True)

    # Server-side convenience flag
    synced = Column(Boolean, default=False, nullable=False)
