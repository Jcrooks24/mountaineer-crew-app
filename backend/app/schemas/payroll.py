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


class ReimbursementDecision(BaseModel):
    """Approve or decline one reimbursement claim from the payroll detail view.

    `status` is deliberately the full word rather than a boolean: the model has
    three states (submitted / approved / rejected) and an admin needs to be able
    to put a claim BACK to submitted after a mis-click, which a boolean cannot
    express.
    """
    status: str
    # Shown to the crew member in the decline email, so it is worth requiring
    # something. A decline with no explanation generates a phone call.
    note: Optional[str] = None

    @field_validator("status")
    @classmethod
    def known_status(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in ("submitted", "approved", "rejected"):
            raise ValueError("status must be submitted, approved or rejected")
        return v

    @field_validator("note")
    @classmethod
    def note_length(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 2000:
            raise ValueError("note too long")
        return v


class ReportWaiverRequest(BaseModel):
    """Waive (or un-waive) the job-report requirement for one job at finalize."""
    waived: bool
    reason: Optional[str] = None

    @field_validator("reason")
    @classmethod
    def reason_length(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 500:
            raise ValueError("reason too long")
        return v


class TipCreate(BaseModel):
    """One tip owed to one employee. Flat dollars, typed in by an admin.

    `tip_date` is the PAYOUT date and decides which pay period the tip lands in.
    It is not derived from the job: tips arrive late, and dating one by its job
    would drop it into a period that has already been finalized. Omitted means
    today (in Mountain time, resolved by the router).
    """
    user_id: int
    amount: float
    tip_date: Optional[str] = None
    job_uuid: Optional[str] = None
    job_name: Optional[str] = None
    note: str = ""

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v: float) -> float:
        # A zero tip records nothing, and a negative one is a deduction wearing
        # a tip's clothes. Payroll corrections are the tool for taking money off.
        if v is None or float(v) <= 0:
            raise ValueError("a tip must be a positive dollar amount")
        if float(v) > 10000:
            raise ValueError("tip looks like a typo (over $10,000)")
        return round(float(v), 2)

    @field_validator("note")
    @classmethod
    def note_length(cls, v: str) -> str:
        v = (v or "").strip()
        if len(v) > 500:
            raise ValueError("note too long")
        return v
