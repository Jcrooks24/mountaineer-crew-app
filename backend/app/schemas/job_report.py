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

# ── Close-out vocabulary ─────────────────────────────────────────────────────
# Fixed lists so the sheet stays groupable. Free text lives alongside them in a
# note field rather than replacing them: a cause you can count is worth more to
# the office than a paragraph, and the paragraph catches what the list misses.
# Mirrored on the frontend in frontend/src/lib/closeout.ts - keep in sync.

# Why the job differed from what was estimated. Multi-select as of 2026-07-28
# (ADR 0028): a day that ran long usually ran long for more than one reason, and
# forcing "the biggest single reason" threw the rest away.
#
# The list runs in BOTH directions. The original vocabulary only described a job
# that ran LONG, so a job that finished well under the estimate had nothing
# truthful to pick and the office lost the signal that its estimate was high.
VARIANCE_CAUSES = {
    # Ran longer than estimated
    "underestimated_volume",
    "access_stairs_carry",
    "client_not_ready",
    "crew_size_or_skill",
    "scope_added_on_site",
    "travel_or_traffic",
    "damage_or_repack",
    # Ran shorter than estimated
    "overestimated_volume",
    "easier_access",
    "client_ahead_of_prep",
    "scope_reduced_on_site",
    "crew_faster_than_expected",
    "other",
}

# How ready the client was on arrival. Single-select, ordered worst to best in
# meaning but stored as opaque keys.
CLIENT_READINESS = {"fully_ready", "mostly_ready", "partly_ready", "not_ready"}

# What specifically was not ready. Multi-select, only meaningful when readiness
# is anything other than fully_ready.
CLIENT_UNREADY_REASONS = {
    "packing_incomplete",
    "parking_not_reserved",
    "elevator_not_reserved",
    "access_blocked",
    "utilities_off",
    "pets_or_kids",
    "paperwork_or_payment",
    "other",
}

# One row per thing that changed on site. Multi-select per row as of 2026-07-28
# (ADR 0028) - a single change is often two of these at once ("client dropped the
# storage unit AND the second stop"), and one row per reason overstated the count.
#
# Reduction-side keys were added at the same time. `reduced_scope` predates them
# and is kept because historical reports carry it; new reports should reach for
# the specific key instead.
SCOPE_CHANGE_KINDS = {
    # Added / more work
    "added_items",
    "extra_stop",
    "packing_added",
    "storage_added",
    "disposal_added",
    "address_changed",
    # Removed / less work
    "fewer_items",
    "stop_dropped",
    "packing_not_needed",
    "storage_not_needed",
    "client_already_packed",
    "less_volume_than_estimated",
    "reduced_scope",  # legacy catch-all, retained for historical reports
    "other",
}

# Which way a scope change moved the day. Stored per entry so a report can carry
# both an addition and a reduction and still net out to a truthful number.
SCOPE_CHANGE_DIRECTIONS = {"added", "saved"}

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

# Interior dimensions, used only to turn a fill percentage into a cubic-foot
# figure on the sheet. Nothing bills off these.
#
# ** Estimates from the box length and typical interior width/height. Measure the
# real fleet and correct them. ** What is stored on the report is the percentage
# the crew observed; the volume is derived from these numbers at export time, so
# correcting a spec changes future exports and re-exports, not the observation.
#
# Mirrored on the frontend in frontend/src/lib/jobTypes.ts (TRUCK_SPECS) so the
# crew and the sheet see the same number. Keep the two in sync.
TRUCK_SPECS = {
    "16Ford": {"length_ft": 16.0, "width_ft": 7.5, "height_ft": 7.0},
    "26Int": {"length_ft": 26.0, "width_ft": 8.0, "height_ft": 8.5},
    "24FR8": {"length_ft": 24.0, "width_ft": 8.0, "height_ft": 8.5},
    "26FR8": {"length_ft": 26.0, "width_ft": 8.0, "height_ft": 8.5},
}

# A rental isn't in the fleet: crew give its length, we assume a standard box.
RENTAL_INTERIOR = {"width_ft": 8.0, "height_ft": 8.0}


def truck_capacity_cuft(entry: dict) -> Optional[int]:
    """Interior volume for one truck-fullness entry, or None when unknowable
    (a rental whose length the crew did not enter)."""
    if entry.get("is_rental"):
        try:
            length = float(entry.get("length_ft") or 0)
        except (TypeError, ValueError):
            return None
        if length <= 0:
            return None
        return round(length * RENTAL_INTERIOR["width_ft"] * RENTAL_INTERIOR["height_ft"])
    spec = TRUCK_SPECS.get((entry.get("truck") or "").strip())
    if not spec:
        return None
    return round(spec["length_ft"] * spec["width_ft"] * spec["height_ft"])


class TruckFullnessEntry(BaseModel):
    """ONE TRUCKLOAD's fill estimate against the interior 25% marks.

    An entry is a LOAD, not a truck. A truck that runs the job twice gets two
    entries, because each trip is filled differently - a first load packed tight
    and a second half-empty is the normal case, and one measurement multiplied by
    two would describe neither. The picker therefore allows the same fleet truck
    more than once.

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
    # Mountain "YYYY-MM-DD" of the shift start. Lets payroll book a multi-day job's
    # hours into the correct pay period per day; absent on legacy rows.
    date: Optional[str] = None
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


SCOPE_REDUCTION_KINDS = {
    "fewer_items",
    "stop_dropped",
    "packing_not_needed",
    "storage_not_needed",
    "client_already_packed",
    "less_volume_than_estimated",
    "reduced_scope",
}


class ScopeChangeEntry(BaseModel):
    """One thing that changed on site after the job was quoted.

    `hours` is the crew's rough estimate of the time the change moved the day by,
    not a billing figure - it is there so the office can see which kinds of change
    actually eat (or give back) the day. Left optional because a crew member who
    cannot estimate it should still be able to log that the change happened.
    `hours` is always a positive magnitude; `direction` carries the sign.

    **Wire compatibility.** Reports written before 2026-07-28 carry a single
    `kind` string and no `direction`. Both are upgraded in the pre-validator
    below rather than at every read site, so a re-export or an admin edit of an
    old report produces the same shape as a new one. Old rows keep flowing
    through unchanged input: the client also still accepts them (see
    frontend/src/lib/closeout.ts).
    """
    kinds: List[str]
    direction: str = "added"
    hours: Optional[float] = None
    note: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _upgrade_legacy(cls, data):
        """Accept the pre-2026-07-28 `{kind, hours, note}` shape.

        Direction is inferred from the kind: the only reduction-flavored key that
        existed back then was `reduced_scope`. Everything else was an addition,
        which is exactly why this change was needed.
        """
        if not isinstance(data, dict):
            return data
        if "kinds" not in data and "kind" in data:
            data = dict(data)
            kind = (data.pop("kind") or "").strip()
            data["kinds"] = [kind] if kind else []
            data.setdefault(
                "direction", "saved" if kind in SCOPE_REDUCTION_KINDS else "added"
            )
        return data

    @field_validator("kinds")
    @classmethod
    def kinds_known(cls, v: List[str]) -> List[str]:
        cleaned = [k.strip() for k in (v or []) if isinstance(k, str) and k.strip()]
        if not cleaned:
            raise ValueError("a scope change needs at least one kind")
        if len(cleaned) > len(SCOPE_CHANGE_KINDS):
            raise ValueError("too many kinds on one scope change")
        unknown = [k for k in cleaned if k not in SCOPE_CHANGE_KINDS]
        if unknown:
            raise ValueError(f"kind must be one of {sorted(SCOPE_CHANGE_KINDS)}")
        # De-duplicate, preserving the order the crew ticked them in.
        seen: set = set()
        return [k for k in cleaned if not (k in seen or seen.add(k))]

    @field_validator("direction")
    @classmethod
    def direction_known(cls, v: str) -> str:
        v = (v or "added").strip() or "added"
        if v not in SCOPE_CHANGE_DIRECTIONS:
            raise ValueError(
                f"direction must be one of {sorted(SCOPE_CHANGE_DIRECTIONS)}"
            )
        return v

    @field_validator("hours")
    @classmethod
    def hours_sane(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return v
        # Magnitude only - `direction` is what makes it add or subtract. A signed
        # value here would double-encode the sign and the two could disagree.
        if not (0 <= v <= 48):
            raise ValueError("hours must be between 0 and 48")
        return round(float(v), 2)

    def signed_hours(self) -> float:
        """Hours as the office should sum them: negative when time was saved."""
        if self.hours is None:
            return 0.0
        return -self.hours if self.direction == "saved" else self.hours

    @field_validator("note")
    @classmethod
    def note_bounded(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 1000:
            raise ValueError("note too long")
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
    # Close-out: why the job differed, how ready the client was, what changed.
    # `variance_causes` is the current field. `variance_cause` (singular) is
    # accepted for a build of the app still sitting on a crew device and folded
    # into the list by the validator below - dropping it would make close-out
    # silently stop recording for anyone who has not refreshed.
    variance_causes: Optional[List[str]] = None
    variance_cause: Optional[str] = None
    variance_note: Optional[str] = None
    client_readiness: Optional[str] = None
    client_unready: Optional[List[str]] = None
    scope_changes: Optional[List[ScopeChangeEntry]] = None
    employee_hours: Optional[List[EmployeeHoursEntry]] = None

    @model_validator(mode="after")
    def _fold_legacy_variance_cause(self) -> "JobReportUpsert":
        """Collapse the singular field into the list.

        Runs after field validation so both have already been checked against
        VARIANCE_CAUSES. The list wins when a client sends both - a new build
        sends only the list, and an old build only the string, so they overlap
        exactly once: never.
        """
        if not self.variance_causes and self.variance_cause:
            self.variance_causes = [self.variance_cause]
        self.variance_cause = None
        return self

    @field_validator("variance_causes")
    @classmethod
    def variance_causes_known(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        cleaned = [t.strip() for t in v if isinstance(t, str) and t.strip()]
        unknown = [t for t in cleaned if t not in VARIANCE_CAUSES]
        if unknown:
            raise ValueError(f"unknown variance cause(s): {unknown}")
        seen: set = set()
        return [t for t in cleaned if not (t in seen or seen.add(t))]

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


    @field_validator("variance_cause")
    @classmethod
    def variance_cause_known(cls, v: Optional[str]) -> Optional[str]:
        # Legacy singular field from an older client build. Validated on the same
        # vocabulary, then folded into variance_causes by the model validator.
        if v in (None, ""):
            return None
        if v not in VARIANCE_CAUSES:
            raise ValueError(f"variance_cause must be one of {sorted(VARIANCE_CAUSES)}")
        return v

    @field_validator("variance_note")
    @classmethod
    def variance_note_clean(cls, v: Optional[str]) -> Optional[str]:
        # Trim here, not only on the client. A whitespace-only note arriving from
        # an older build (or a re-export) would otherwise be stored non-null and
        # read as "the crew wrote something" in a cell that looks empty.
        if v is None:
            return None
        v = v.strip()
        if len(v) > 2000:
            raise ValueError("variance_note too long")
        return v or None

    @field_validator("client_readiness")
    @classmethod
    def client_readiness_known(cls, v: Optional[str]) -> Optional[str]:
        if v in (None, ""):
            return None
        if v not in CLIENT_READINESS:
            raise ValueError(f"client_readiness must be one of {sorted(CLIENT_READINESS)}")
        return v

    @field_validator("client_unready")
    @classmethod
    def client_unready_known(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        cleaned = [t.strip() for t in v if isinstance(t, str) and t.strip()]
        unknown = [t for t in cleaned if t not in CLIENT_UNREADY_REASONS]
        if unknown:
            raise ValueError(f"unknown client_unready reason(s): {unknown}")
        # De-duplicate but keep the order the crew ticked them in.
        seen: set = set()
        return [t for t in cleaned if not (t in seen or seen.add(t))]

    @field_validator("scope_changes")
    @classmethod
    def scope_changes_bounded(cls, v):
        if v is not None and len(v) > 50:
            raise ValueError("too many scope_changes")
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
    # Who last changed the report, as distinct from who filed it. None until
    # somebody edits it. See the model for why the two are separate columns.
    last_edited_by_id: Optional[int] = None
    last_edited_by_name: Optional[str] = None
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
    # Close-out: why the job differed, how ready the client was, what changed.
    # Always a list on the way out, even for reports stored under the old
    # singular column - the router normalizes on read.
    variance_causes: Optional[List[str]] = None
    variance_note: Optional[str] = None
    client_readiness: Optional[str] = None
    client_unready: Optional[List[str]] = None
    scope_changes: Optional[List[ScopeChangeEntry]] = None
    employee_hours: Optional[List[EmployeeHoursEntry]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
