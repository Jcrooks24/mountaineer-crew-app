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

    # Who FIRST submitted this report. Write-once: set when the row is created
    # and never reassigned afterwards.
    #
    # These used to be overwritten with the current user on every update, so the
    # report was attributed to whoever saved it last. An admin opening a closed
    # job and saving anything became "the person who submitted the report" even
    # though they were never on the job. Reported 2026-08-12.
    #
    # Rows written before that fix hold whoever saved last, and there is no way
    # to recover the original submitter from the data. The fix stops the drift;
    # it cannot repair history.
    submitted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_by_name = Column(String, nullable=True)

    # Who last changed it. Null on a report nobody has edited since it was
    # created, which is how the UI tells "untouched" from "edited by the same
    # person who submitted it".
    last_edited_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    last_edited_by_name = Column(String, nullable=True)

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
    # ── Close-out (added 2026-07-27) ────────────────────────────────────────
    # Why the job differed from the quote, plus a note for what the list cannot
    # say. Nullable throughout - every report submitted before this existed has
    # none, and a crew member who cannot answer is not blocked.
    #
    # `variance_cause` (singular String) was the original column and holds one
    # key for every report written 07-27 through 07-28. It is READ-ONLY now:
    # writes go to `variance_causes_json` and the router falls back to this
    # column when the JSON one is null. Backfilling it away would have been a
    # data migration over live reports to save one nullable column; the fallback
    # is cheaper and cannot lose a row. See ADR 0028.
    variance_cause = Column(String, nullable=True)
    # JSON list of keys from VARIANCE_CAUSES. Current write target.
    variance_causes_json = Column(Text, nullable=True)
    variance_note = Column(Text, nullable=True)

    # How ready the client was on arrival, plus what specifically was not ready
    # (JSON list of keys from CLIENT_UNREADY_REASONS).
    client_readiness = Column(String, nullable=True)
    client_unready_json = Column(Text, nullable=True)

    # One entry per on-site scope change: {kinds[], direction, hours, note}.
    # JSON for the same reason employee_hours_json is: it is a per-report list
    # nobody queries relationally, and the sheet is where it gets analysed.
    #
    # Rows written before 2026-07-28 hold the older {kind, hours, note} shape.
    # No migration rewrites them - ScopeChangeEntry upgrades on read (ADR 0028),
    # so the two shapes coexist in this column indefinitely.
    scope_changes_json = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False)
    # Indexed: the worked-hours query filters on it to bound its scan to the
    # last two weeks (see routers/hours.py).
    updated_at = Column(DateTime, nullable=False, index=True)
