from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.event import Event
from app.db.models.job_inventory import JobInventoryItem
from app.db.models.job_report import JobReport
from app.db.models.user import User
from app.routers.job_inventory import counts_for
from app.integrations.sheets_export import (
    estimated_hours_for,
    export_job_report_to_sheets,
    run_export_in_background,
)
from app.schemas.job_report import (
    EmployeeHoursEntry,
    JobReportResponse,
    JobReportUpsert,
    TruckFullnessEntry,
)

router = APIRouter(prefix="/api/job-report", tags=["job-report"])


def _decode_employee_hours(raw: Optional[str]) -> Optional[list[EmployeeHoursEntry]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [EmployeeHoursEntry(**row) for row in data if isinstance(row, dict)]
    except (json.JSONDecodeError, ValueError):
        return None


def _decode_job_type_tags(raw: Optional[str]) -> Optional[list[str]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [str(t) for t in data]
    except (json.JSONDecodeError, ValueError):
        return None


def _decode_truck_fullness(raw: Optional[str]) -> Optional[list[TruckFullnessEntry]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [TruckFullnessEntry(**row) for row in data if isinstance(row, dict)]
    except (json.JSONDecodeError, ValueError):
        return None


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
        has_crew_feedback=r.has_crew_feedback,
        crew_feedback=r.crew_feedback,
        out_of_town=bool(r.out_of_town),
        bill_personal_vehicles=bool(r.bill_personal_vehicles),
        job_type_tags=_decode_job_type_tags(r.job_type_tags_json),
        truck_fullness=_decode_truck_fullness(r.truck_fullness_json),
        overage_note=r.overage_note,
        hours_verified=bool(r.hours_verified),
        employee_hours=_decode_employee_hours(r.employee_hours_json),
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _job_name_for(db: Session, job_uuid: str) -> str:
    """Best-effort job name lookup - grab the most recent non-empty job_name from events."""
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
    employees = _decode_employee_hours(report.employee_hours_json)
    truck_fullness = _decode_truck_fullness(report.truck_fullness_json)

    # Derived furniture/box counts from the actual inventory logged on this job.
    # Left blank (None) when no inventory rows exist, so the sheet cell reads
    # empty rather than a misleading 0.
    inv_items = (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.job_uuid == report.job_uuid)
        .all()
    )
    if inv_items:
        furniture_count, box_count = counts_for(inv_items)
    else:
        furniture_count = box_count = None

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
        "has_crew_feedback": report.has_crew_feedback,
        "crew_feedback": report.crew_feedback,
        "out_of_town": bool(report.out_of_town),
        "bill_personal_vehicles": bool(report.bill_personal_vehicles),
        "job_type_tags": _decode_job_type_tags(report.job_type_tags_json) or [],
        "truck_fullness": [t.model_dump() for t in truck_fullness] if truck_fullness else [],
        "furniture_count": "" if furniture_count is None else furniture_count,
        "box_count": "" if box_count is None else box_count,
        "overage_note": report.overage_note or "",
        "hours_verified": bool(report.hours_verified),
        "employee_hours": [e.model_dump() for e in employees] if employees else [],
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

    employee_hours_json = (
        json.dumps([e.model_dump() for e in body.employee_hours])
        if body.employee_hours
        else None
    )
    job_type_tags_json = (
        json.dumps(body.job_type_tags) if body.job_type_tags else None
    )
    truck_fullness_json = (
        json.dumps([t.model_dump() for t in body.truck_fullness])
        if body.truck_fullness
        else None
    )

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
        existing.has_crew_feedback = body.has_crew_feedback
        existing.crew_feedback = body.crew_feedback
        existing.out_of_town = body.out_of_town
        existing.bill_personal_vehicles = body.bill_personal_vehicles
        existing.job_type_tags_json = job_type_tags_json
        existing.truck_fullness_json = truck_fullness_json
        existing.overage_note = body.overage_note
        existing.hours_verified = body.hours_verified
        existing.employee_hours_json = employee_hours_json
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
        has_crew_feedback=body.has_crew_feedback,
        crew_feedback=body.crew_feedback,
        out_of_town=body.out_of_town,
        bill_personal_vehicles=body.bill_personal_vehicles,
        job_type_tags_json=job_type_tags_json,
        truck_fullness_json=truck_fullness_json,
        overage_note=body.overage_note,
        hours_verified=body.hours_verified,
        employee_hours_json=employee_hours_json,
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


@router.get("/estimated-hours")
def get_estimated_hours(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Estimated crew-hours baseline for a job + its source ("estimate" |
    "schedule" | ""). Powers the Report tab's est-vs-actual line; the crew
    computes the actual side from the live employee-hours in the form."""
    hours, source = estimated_hours_for(db, job_uuid)
    return {"job_uuid": job_uuid, "estimated_hours": hours, "source": source}
