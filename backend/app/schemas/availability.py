from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, field_validator


AvailabilityStatus = Literal["available", "unavailable", "conditional"]


class AvailabilityDayIn(BaseModel):
    day: str           # ISO YYYY-MM-DD
    status: AvailabilityStatus
    note: Optional[str] = None

    @field_validator("day")
    @classmethod
    def day_iso(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("day is required")
        # Cheap parse to catch typos / wrong formats. Full ISO date validation
        # is out of scope; this is enough to surface client bugs early.
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError as e:
            raise ValueError(f"day must be YYYY-MM-DD: {v}") from e
        return v


class AvailabilityBatchIn(BaseModel):
    """A single submission from the device. `window_start` should be the
    first day of the 14-day window the crew filled in — the sheet aggregator
    groups all days that share a window_start into one admin-readable row.

    `days` is the full list the crew touched in this submission. Each entry
    upserts on (user_id, day): the most recent submission wins.
    """
    window_start: str
    days: List[AvailabilityDayIn]

    @field_validator("window_start")
    @classmethod
    def window_iso(cls, v: str) -> str:
        v = (v or "").strip()
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError as e:
            raise ValueError(f"window_start must be YYYY-MM-DD: {v}") from e
        return v


class AvailabilityDayOut(BaseModel):
    day: str
    status: AvailabilityStatus
    note: Optional[str]
    window_start: str
    updated_at: datetime

    class Config:
        from_attributes = True


class AvailabilityState(BaseModel):
    """Server view of a crew member's current availability.

    `horizon` = the last day the user has submitted availability for, or null
    if they've never submitted. The "submit next 2 weeks" prompt on the
    device fires when `horizon - today < 14 days`.
    """
    horizon: Optional[str]
    days: List[AvailabilityDayOut]
