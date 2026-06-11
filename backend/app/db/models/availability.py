"""
AvailabilityDay model.

Crew submit forward-looking availability one 14-day window at a time
(see project_scheduling_availability_design memory for the locked rules).
The DB shape is normalized — one row per (crew, calendar day) — so admin
queries like "who's free Tuesday?" stay simple, and sheet export can still
aggregate up into one row per (crew, window) for human reading.

`window_start` is stamped at insert time so the sheet aggregator can group
days back into the same window the crew submitted them in, even when the
crew later edits a single day within that window.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from app.db.session import Base


AVAILABILITY_STATUSES = ("available", "unavailable", "conditional")


class AvailabilityDay(Base):
    __tablename__ = "availability_days"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String, nullable=False)

    day = Column(String, nullable=False, index=True)
    status = Column(String(16), nullable=False)
    note = Column(Text, nullable=True)

    window_start = Column(String, nullable=False, index=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_availability_user_day"),
    )
