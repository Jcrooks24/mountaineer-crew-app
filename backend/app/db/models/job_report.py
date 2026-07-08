"""
Job Report model.
Captures per-job wrap-up data: vehicle count, waste estimates,
billing preference, review candidacy, and hours reconciliation.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


# Allowed values for `review_candidate`. Mirrors the frontend ThreeWay
# picker; sheet export maps to "Yes" / "No" / "N/A" for human readability.
REVIEW_CANDIDATE_VALUES = ("yes", "no", "na")


class JobReport(Base):
    __tablename__ = "job_reports"

    id = Column(Integer, primary_key=True, index=True)

    # Ties report to an offline-first job
    job_uuid = Column(String, unique=True, index=True, nullable=False)

    # Submitter
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_by_name = Column(String, nullable=True)

    # ── Field data ───────────────────────────────────────────────────────────

    # How many personal vehicles were driven to the job site
    personal_vehicles = Column(Integer, nullable=False, default=0)

    # M1 dumpster fill level (0–100, multiples of 5)
    dumpster_pct = Column(Integer, nullable=False, default=0)

    # M1 recycling fill level (0–100, multiples of 5)
    recycling_pct = Column(Integer, nullable=False, default=0)

    # One of: crew_cash_check | office_invoice | office_arrange | end_of_job
    billing_method = Column(String, nullable=False)

    # Should the office reach out for a review? One of REVIEW_CANDIDATE_VALUES.
    review_candidate = Column(String(8), nullable=False)

    # Do hours worked match hours billed?
    hours_match = Column(Boolean, nullable=False)
    hours_mismatch_reason = Column(Text, nullable=True)

    # Optional crew feedback to the office about this job. Two columns so a
    # "No" answer is distinct from "Yes with empty body" (the textarea only
    # appears when has_crew_feedback is True).
    has_crew_feedback = Column(Boolean, nullable=True)
    crew_feedback = Column(Text, nullable=True)

    # Long-distance: the submitter started AND ended the day out of town (drives
    # the $50/day per-diem on the JobReports sheet). Nullable so pre-existing
    # rows read as False without a backfill.
    out_of_town = Column(Boolean, nullable=True, default=False)

    # Personal vehicles at the job site are billed as crew transport vehicles
    # ($100/vehicle/day). Nullable so pre-existing rows read as False without
    # a backfill; drives the auto-populated Invoice Builder line items.
    bill_personal_vehicles = Column(Boolean, nullable=True, default=False)

    # JSON-encoded list of per-employee entries:
    #   [{ name, start: "HH:MM", end: "HH:MM", break_hours: float, hours: float,
    #      skill_rating: int|null }]
    # Crew enters these on the Report tab using the time-math helper. Stored
    # as Text to match the existing JobBill / MaterialsSubmission pattern.
    # skill_rating (1-5, null = N/A) rides inside each entry - no separate column.
    employee_hours_json = Column(Text, nullable=True)

    # JSON array of job-type tags from the fixed vocabulary (see JOB_TYPE_TAGS
    # in schemas/job_report.py). Multi-select; drives per-mover skill-exposure
    # accrual by job type downstream. Nullable so pre-existing rows read empty
    # without a backfill.
    job_type_tags_json = Column(Text, nullable=True)

    # JSON array of per-truck fullness readings:
    #   [{ truck, vertical_pct, horizontal_pct }] where pct ∈ {25,50,75,100}.
    # Crew estimates fill against the interior 25% marks. Nullable - blank when
    # not collected.
    truck_fullness_json = Column(Text, nullable=True)

    # Crew's explanation when the actual inventory ran over the linked estimate
    # (extra items, different access, stairs/parking). Captured by the overage
    # prompt - the objective est-vs-actual note for the client conversation.
    overage_note = Column(Text, nullable=True)

    # Crew-lead sign-off that the per-employee hours are correct. Null = not yet
    # verified; the crew-lead-only checkbox on the report sets it.
    hours_verified = Column(Boolean, nullable=True, default=False)

    # Timestamps
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
