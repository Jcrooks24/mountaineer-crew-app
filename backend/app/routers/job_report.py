from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.event import Event
from app.db.models.job_report import JobReport
from app.db.models.user import User
from app.integrations.sheets_export import export_job_report_to_sheets, run_export_in_background
from app.schemas.job_report import JobReportResponse, JobReportUpsert

router = APIRouter(prefix="/api/job-report", tags=["job-report"])


def _to_response(r: JobReport) -> JobReportResponse:
    return JobReportResponse(
        id=r.id,
        job_uuid=r.job_uuid,
        submitted_by_id=r.submitted_by_id,
        submitted_by_name=r.submitted_by_name,
        personal_vehicles=r.personal_vehicles,
        dumpster_pct=r.dumpster_pct,
        recycling_pct=r.recycling_pct,
        billing_method=r.billing_method,
        review_candidate=r.review_candidate,
        hours_match=r.hours_match,
        hours_mismatch_reason=r.hours_mismatch_reason,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _job_name_for(db: Session, job_uuid: str) -> str:
    """Best-effort job name lookup — grab the most recent non-empty job_name from events."""
    row = (
        db.query(Event.job_name)
        .filter(Event.job_uuid == job_uuid, Event.job_name.isnot(None), Event.job_name != "")
        .order_by(Event.timestamp.desc())
        .first()
    )
    return row[0] if row and row[0] else ""


def _export_report_to_sheets(db: Session, report: JobReport) -> None:
    # Capture all the data in the request thread (before the db session
    # closes), then push the actual sheets call onto a background thread
    # so the API response is never blocked by Google.
    payload = {
        "job_uuid": report.job_uuid,
        "job_name": _job_name_for(db, report.job_uuid),
        "submitted_by_name": report.submitted_by_name,
        "personal_vehicles": report.personal_vehicles,
        "dumpster_pct": report.dumpster_pct,
        "recycling_pct": report.recycling_pct,
        "billing_method": report.billing_method,
        "review_candidate": report.review_candidate,
        "hours_match": report.hours_match,
        "hours_mismatch_reason": report.hours_mismatch_reason,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }
    run_export_in_background(export_job_report_to_sheets, payload)


@router.post("", response_model=JobReportResponse)
def upsert_job_report(
    body: JobReportUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    existing = db.query(JobReport).filter(JobReport.job_uuid == body.job_uuid).first()

    if existing:
        existing.submitted_by_id = current_user.id
        existing.submitted_by_name = current_user.name or current_user.email
        existing.personal_vehicles = body.personal_vehicles
        existing.dumpster_pct = body.dumpster_pct
        existing.recycling_pct = body.recycling_pct
        existing.billing_method = body.billing_method
        existing.review_candidate = body.review_candidate
        existing.hours_match = body.hours_match
        existing.hours_mismatch_reason = body.hours_mismatch_reason
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        _export_report_to_sheets(db, existing)
        return _to_response(existing)

    report = JobReport(
        job_uuid=body.job_uuid,
        submitted_by_id=current_user.id,
        submitted_by_name=current_user.name or current_user.email,
        personal_vehicles=body.personal_vehicles,
        dumpster_pct=body.dumpster_pct,
        recycling_pct=body.recycling_pct,
        billing_method=body.billing_method,
        review_candidate=body.review_candidate,
        hours_match=body.hours_match,
        hours_mismatch_reason=body.hours_mismatch_reason,
        created_at=now,
        updated_at=now,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    _export_report_to_sheets(db, report)
    return _to_response(report)


@router.get("", response_model=JobReportResponse)
def get_job_report(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    report = db.query(JobReport).filter(JobReport.job_uuid == job_uuid).first()
    if not report:
        raise HTTPException(status_code=404, detail="No report for this job yet")
    return _to_response(report)
