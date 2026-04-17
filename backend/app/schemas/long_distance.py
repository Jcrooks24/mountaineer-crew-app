from __future__ import annotations

from datetime import datetime
from typing import List

from pydantic import BaseModel


class DailyHours(BaseModel):
    date: str  # YYYY-MM-DD
    hours: float


class PriorOnDutyCreate(BaseModel):
    statement_id: str
    driver_name: str
    statement_date: str           # YYYY-MM-DD
    daily_hours: List[DailyHours]
    hours_last_24: float
    signature: str                # base64 PNG data URL
    signed_at: datetime


class PriorOnDutyResponse(BaseModel):
    id: int
    statement_id: str
    driver_id: int | None
    driver_name: str
    statement_date: str
    daily_hours: List[DailyHours]
    hours_last_24: float
    signature: str
    signed_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True
