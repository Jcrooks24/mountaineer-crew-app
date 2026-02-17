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

    # When the event happened (device time)
    timestamp = Column(DateTime, nullable=False)

    # Optional geotag captured only at event time
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    accuracy_m = Column(Float, nullable=True)

    # Optional free text
    note = Column(String, nullable=True)

    # Server-side convenience flag
    synced = Column(Boolean, default=False, nullable=False)
