from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


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
    """One truck's fill estimate against the interior 25% marks.

    Fleet trucks must be one of TRUCK_IDS. Rental trucks (is_rental) carry a
    free-text label and an optional length_ft, since they're not in the fixed
    fleet and have no interior markers - their fill is a best-guess estimate.
    """
    truck: str
    vertical_pct: int
    horizontal_pct: int
    is_rental: bool = False
    length_ft: Optional[float] = None

    @model_validator(mode="after")
    def _validate_truck(self) -> "TruckFullnessEntry":
        if self.is_rental:
            if not (self.truck or "").strip():
                raise ValueError("rental truck requires a name")
        elif self.truck not in TRUCK_IDS:
            raise ValueError(f"truck must be one of {TRUCK_IDS} (or mark it a rental)")
        if self.length_ft is not None and not (0 <= self.length_ft <= 100):
            raise ValueError("length_ft must be between 0 and 100")
        return self

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
    # The roster user this row is for. THIS is the match key: the worked-hours
    # summary joins on it, so a rename, a nickname, or a typo no longer silently
    # drops somebody's hours. `name` is kept for display and for the sheet, and is
    # the only thing legacy rows (written before this field existed) have, so the
    # server still falls back to matching on it. Optional for exactly that reason.
    user_id: Optional[int] = None
    name: str
    start: str = ""           # "HH:MM" 24-hour or empty if user logged duration only
    end: str = ""             # "HH:MM" 24-hour or empty
    break_hours: float = 0.0  # base-10 hours subtracted from worked time
    hours: float = 0.0        # actual worked hours, base-10
    non_billable: bool = False  # excluded from total man-hours when true
    out_of_town: bool = False  # long-distance: $50 per-diem owed to this employee
    skill_rating: Optional[int] = None  # legacy single 1-5 rating; None = N/A.
    # Per-skill ratings keyed by skill name (0-5, or -1 for "N/A" when the crew
    # marked a relevant skill not-applicable). Only job-relevant skills are
    # rated. Display-only - never affects the man-hours math.
    skill_ratings: Optional[Dict[str, int]] = None

    @field_validator("skill_rating")
    @classmethod
    def skill_rating_valid(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError("skill_rating must be 1-5 or null")
        return v

    @field_validator("skill_ratings")
    @classmethod
    def skill_ratings_valid(cls, v: Optional[Dict[str, int]]) -> Optional[Dict[str, int]]:
        if v is None:
            return v
        if len(v) > 100:
            raise ValueError("too many skill_ratings")
        for name, rating in v.items():
            # -1 = explicit "not applicable"; 0-5 = a real score.
            if not isinstance(rating, int) or not (rating == -1 or 0 <= rating <= 5):
                raise ValueError(f"skill rating for {name!r} must be 0-5 or -1 (N/A)")
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
    hours_verified: bool = False
    employee_hours: Optional[List[EmployeeHoursEntry]] = None

    @field_validator("job_type_tags")
    @classmethod
    def job_type_tags_valid(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        # Job types are admin-configurable (see the job_types table), so we no
        # longer validate against a fixed vocabulary here - only sanity-bound
        # the input. Unknown/renamed tags on historical reports stay valid.
        if v is None:
            return v
        if len(v) > 50:
            raise ValueError("too many job_type_tags")
        cleaned = [t.strip() for t in v if isinstance(t, str) and t.strip()]
        if any(len(t) > 64 for t in cleaned):
            raise ValueError("job_type_tag too long")
        return cleaned

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
    hours_verified: bool = False
    employee_hours: Optional[List[EmployeeHoursEntry]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
