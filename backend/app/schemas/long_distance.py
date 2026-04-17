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


# ── RODS ──────────────────────────────────────────────────────────────────


class DutyChange(BaseModel):
    time: str       # "HH:MM" 24-hour local
    status: str     # off_duty | sleeper | driving | on_duty
    location: str | None = None
    remarks: str | None = None


class RodsCreate(BaseModel):
    rods_id: str
    driver_name: str
    log_date: str                # YYYY-MM-DD
    co_driver_name: str | None = None
    vehicle_number: str | None = None
    trailer_number: str | None = None
    origin: str | None = None
    destination: str | None = None
    total_miles: str | None = None
    shipping_docs: str | None = None
    carrier: str | None = None
    main_office_address: str | None = None
    duty_changes: List[DutyChange]
    remarks: str | None = None
    total_off_duty: str | None = None
    total_sleeper: str | None = None
    total_driving: str | None = None
    total_on_duty: str | None = None
    signature: str
    signed_at: datetime


class RodsResponse(BaseModel):
    id: int
    rods_id: str
    driver_id: int | None
    driver_name: str
    log_date: str
    co_driver_name: str | None
    vehicle_number: str | None
    trailer_number: str | None
    origin: str | None
    destination: str | None
    total_miles: str | None
    shipping_docs: str | None
    carrier: str | None
    main_office_address: str | None
    duty_changes: List[DutyChange]
    remarks: str | None
    total_off_duty: str | None
    total_sleeper: str | None
    total_driving: str | None
    total_on_duty: str | None
    signature: str
    signed_at: datetime
    created_at: datetime

    class Config:
        from_attributes = True
