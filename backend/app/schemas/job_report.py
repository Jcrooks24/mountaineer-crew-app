from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, field_validator


BILLING_METHODS = {
    "crew_cash",
    "crew_check",
    "office_invoice",
    "office_arrange_cash",
    "office_arrange_check",
    "end_of_job",
}

ReviewCandidate = Literal["yes", "no", "na"]

# Fixed job-type vocabulary (multi-select). Mirrored on the frontend in
# frontend/src/lib/jobTypes.ts - keep the two lists in sync.
JOB_TYPE_TAGS = {
    "Local",
    "Long-distance",
    "Labor-only",
    "Packing",
    "Unpacking",
    "Commercial",
    "Delivery",
    "Storage",
}

# The four trucks; a fullness reading is captured per truck used on the job.
# Mirrored on the frontend in frontend/src/lib/jobTypes.ts.
TRUCK_IDS = {"16Ford", "26Int", "24FR8", "26FR8"}


class TruckFullnessEntry(BaseModel):
    """One truck's fill estimate against the interior 25% marks."""
    truck: str
    vertical_pct: int
    horizontal_pct: int

    @field_validator("truck")
    @classmethod
    def truck_valid(cls, v: str) -> str:
        if v not in TRUCK_IDS:
            raise ValueError(f"truck must be one of {TRUCK_IDS}")
        return v

    @field_validator("vertical_pct", "horizontal_pct")
    @classmethod
    def pct_in_range(cls, v: int) -> int:
        # Sliders send any 0-100 value (step 5 on the client). Keep the bound
        # check but no longer require the old 25/50/75/100 buckets.
        if v < 0 or v > 100:
            raise ValueError("fullness must be between 0 and 100")
        return v


class EmployeeHoursEntry(BaseModel):
    """Single row in the per-job employee-hours table on the Report tab.

    `hours` is the *actual* worked time in base-10 hours. The company's
    billing rule rounds to the nearest quarter (≥5 min → up, else down)
    at display + sheet-export time, so the unrounded value stays
    available downstream.
    """
    name: str
    start: str = ""           # "HH:MM" 24-hour or empty if user logged duration only
    end: str = ""             # "HH:MM" 24-hour or empty
    break_hours: float = 0.0  # base-10 hours subtracted from worked time
    hours: float = 0.0        # actual worked hours, base-10
    non_billable: bool = False  # excluded from total man-hours when true
    out_of_town: bool = False  # long-distance: $50 per-diem owed to this employee
    skill_rating: Optional[int] = None  # crew-lead 1-5 rating; None = N/A. Display-only.

    @field_validator("skill_rating")
    @classmethod
    def skill_rating_valid(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError("skill_rating must be 1-5 or null")
        return v


class JobReportUpsert(BaseModel):
    job_uuid: str
    personal_vehicles: int = 0
    dumpster_pct: int = 0
    recycling_pct: int = 0
    billing_method: str
    review_candidate: ReviewCandidate
    hours_match: bool
    hours_mismatch_reason: Optional[str] = None
    has_crew_feedback: Optional[bool] = None
    crew_feedback: Optional[str] = None
    out_of_town: bool = False
    bill_personal_vehicles: bool = False
    job_type_tags: Optional[List[str]] = None
    truck_fullness: Optional[List[TruckFullnessEntry]] = None
    overage_note: Optional[str] = None
    employee_hours: Optional[List[EmployeeHoursEntry]] = None

    @field_validator("job_type_tags")
    @classmethod
    def job_type_tags_valid(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        bad = [t for t in v if t not in JOB_TYPE_TAGS]
        if bad:
            raise ValueError(f"unknown job_type_tags: {bad}")
        return v

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
    review_candidate: ReviewCandidate
    hours_match: bool
    hours_mismatch_reason: Optional[str]
    has_crew_feedback: Optional[bool] = None
    crew_feedback: Optional[str] = None
    out_of_town: bool = False
    bill_personal_vehicles: bool = False
    job_type_tags: Optional[List[str]] = None
    truck_fullness: Optional[List[TruckFullnessEntry]] = None
    overage_note: Optional[str] = None
    employee_hours: Optional[List[EmployeeHoursEntry]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
