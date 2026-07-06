from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class CalendarJob(Base):
    __tablename__ = "calendar_jobs"

    # The Google Calendar event ID - primary key and unique lookup key
    calendar_event_id = Column(String, primary_key=True, index=True)

    # Canonical job UUID shared across all devices
    job_uuid = Column(String, unique=True, nullable=False, index=True)

    # Scheduled window from the Google Calendar event (ISO strings), cached at
    # resolve time so the server can compute a scheduled-duration baseline for
    # est-vs-actual hours (Phase 4) without a live Calendar API call. Nullable -
    # older rows and manual jobs have no window.
    scheduled_start = Column(String, nullable=True)
    scheduled_end = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
