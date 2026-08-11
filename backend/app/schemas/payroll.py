"""Request schemas for the admin payroll tool.

The summary response is assembled as plain dicts in routers/payroll.py rather
than modelled here: it is a read-only report whose shape is driven by what the
page renders, and a Pydantic mirror of it would be a second thing to keep in
sync for no validation benefit. These models exist for the two endpoints that
take input, where validation is load-bearing.
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, field_validator


class PayrollCorrectionUpsert(BaseModel):
    period_start: str
    period_end: str
    user_id: int
    source: str
    # Empty for a manual line; the router mints a unique key in that case.
    source_key: str = ""
    source_label: Optional[str] = None
    work_date: str
    bucket: str = "billable"
    original_hours: float = 0.0
    corrected_hours: float = 0.0
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        """A correction without a reason is not allowed.

        This is not tidiness: the reason is the body of the email the crew
        member receives. "Your hours were changed, no explanation" is worse for
        trust than not telling them at all, and an admin who cannot articulate
        why probably should not be changing the number.
        """
        v = (v or "").strip()
        if not v:
            raise ValueError("a correction needs a reason - the crew member is told it")
        if len(v) > 2000:
            raise ValueError("reason too long")
        return v

    @field_validator("original_hours", "corrected_hours")
    @classmethod
    def hours_sane(cls, v: float) -> float:
        # 0 is legitimate (a correction to zero removes hours somebody did not
        # work). Negative is not: hours move between buckets, they never go
        # below nothing, and a negative here would silently subtract from a
        # week's OT total.
        if v < 0:
            raise ValueError("hours cannot be negative")
        if v > 400:
            raise ValueError("hours out of range")
        return round(float(v), 2)


class JobCorrectionUpsert(BaseModel):
    """A correction made from the Job Summary (ADR 0032).

    Deliberately smaller than PayrollCorrectionUpsert: the job (path param), the
    work date, and what the crew reported are all derived server-side from the
    job's record, so the admin supplies only who, which bucket, the corrected
    number, and why. There is no period - a job correction is not period-scoped.
    """

    user_id: int
    bucket: str = "billable"
    corrected_hours: float = 0.0
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("a correction needs a reason - the crew member is told it")
        if len(v) > 2000:
            raise ValueError("reason too long")
        return v

    @field_validator("corrected_hours")
    @classmethod
    def hours_sane(cls, v: float) -> float:
        if v < 0:
            raise ValueError("hours cannot be negative")
        if v > 400:
            raise ValueError("hours out of range")
        return round(float(v), 2)


class PayrollFinalizeRequest(BaseModel):
    period_start: str
    period_end: str
    # Crew whose corrections were already discussed in person. They are stamped
    # notified so a later finalize does not mail what was deliberately withheld.
    suppress_user_ids: Optional[List[int]] = None
