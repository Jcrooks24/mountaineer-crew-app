"""
Job Report model.
Captures per-job wrap-up data: vehicle count, waste estimates,
billing preference, review candidacy, and hours reconciliation.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


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

    # Should the office reach out for a review?
    review_candidate = Column(Boolean, nullable=False)

    # Do hours worked match hours billed?
    hours_match = Column(Boolean, nullable=False)
    hours_mismatch_reason = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
