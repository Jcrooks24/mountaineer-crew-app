from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class CalendarJob(Base):
    __tablename__ = "calendar_jobs"

    # The Google Calendar event ID — primary key and unique lookup key
    calendar_event_id = Column(String, primary_key=True, index=True)

    # Canonical job UUID shared across all devices
    job_uuid = Column(String, unique=True, nullable=False, index=True)

    created_at = Column(DateTime, server_default=func.now())
