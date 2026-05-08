from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator


BILLING_METHODS = {
    "crew_cash",
    "crew_check",
    "office_invoice",
    "office_arrange_cash",
    "office_arrange_check",
    "end_of_job",
}


class EmployeeHoursEntry(BaseModel):
    """Single row in the per-job employee-hours table on the Report tab."""
    name: str
    start: str = ""           # "HH:MM" 24-hour or empty if user logged duration only
    end: str = ""             # "HH:MM" 24-hour or empty
    break_hours: float = 0.0  # base-10 hours subtracted from worked time
    hours: float = 0.0        # final worked hours, base-10


class JobReportUpsert(BaseModel):
    job_uuid: str
    personal_vehicles: int = 0
    dumpster_pct: int = 0
    recycling_pct: int = 0
    billing_method: str
    review_candidate: bool
    hours_match: bool
    hours_mismatch_reason: Optional[str] = None
    employee_hours: Optional[List[EmployeeHoursEntry]] = None

    @field_validator("personal_vehicles")
    @classmethod
    def vehicles_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("personal_vehicles must be >= 0")
        return v

    @field_validator("dumpster_pct", "recycling_pct")
    @classmethod
    def pct_valid(cls, v: int) -> int:
        if not (0 <= v <= 100) or v % 5 != 0:
            raise ValueError("Percentage must be 0–100 in multiples of 5")
        return v

    @field_validator("billing_method")
    @classmethod
    def billing_valid(cls, v: str) -> str:
        if v not in BILLING_METHODS:
            raise ValueError(f"billing_method must be one of {BILLING_METHODS}")
        return v


class JobReportResponse(BaseModel):
    id: int
    job_uuid: str
    submitted_by_id: Optional[int]
    submitted_by_name: Optional[str]
    personal_vehicles: int
    dumpster_pct: int
    recycling_pct: int
    billing_method: str
    review_candidate: bool
    hours_match: bool
    hours_mismatch_reason: Optional[str]
    employee_hours: Optional[List[EmployeeHoursEntry]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
