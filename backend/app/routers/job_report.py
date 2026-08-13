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
    export_job_report_to_sheets,
    run_export_in_background,
)
from app.schemas.job_report import (
    EmployeeHoursEntry,
    JobReportResponse,
    JobReportUpsert,
    ScopeChangeEntry,
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


def _decode_str_list(raw: Optional[str]) -> Optional[list[str]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return [str(t) for t in data]
    except (json.JSONDecodeError, ValueError):
        return None


def _decode_scope_changes(raw: Optional[str]) -> Optional[list[ScopeChangeEntry]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        out: list[ScopeChangeEntry] = []
        for row in data:
            if not isinstance(row, dict):
                continue
            try:
                # Rows stored before 2026-07-28 carry {kind, ...}; the entry
                # model upgrades them to {kinds[], direction} on construction.
                out.append(ScopeChangeEntry(**row))
            except ValueError:
                # A row whose kind was retired from the vocabulary should not
                # make the whole report unreadable. Drop it and keep the rest.
                continue
        return out
    except (json.JSONDecodeError, ValueError):
        return None


def _decode_variance_causes(r: JobReport) -> Optional[list[str]]:
    """Close-out variance causes, from whichever column holds them.

    The JSON column is the current write target. Reports written 2026-07-27 to
    2026-07-28 only have the singular string column, which is never written
    again but is still the only record of their cause (ADR 0028).
    """
    from_json = _decode_str_list(r.variance_causes_json)
    if from_json is not None:
        return from_json
    return [r.variance_cause] if r.variance_cause else None

def _to_response(r: JobReport) -> JobReportResponse:
    return JobReportResponse(
        id=r.id,
        job_uuid=r.job_uuid,
        submitted_by_id=r.submitted_by_id,
        submitted_by_name=r.submitted_by_name,
        last_edited_by_id=r.last_edited_by_id,
        last_edited_by_name=r.last_edited_by_name,
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
        variance_causes=_decode_variance_causes(r),
        variance_note=r.variance_note,
        variance_direction=r.variance_direction,
        variance_cause_identified=r.variance_cause_identified,
        client_readiness=r.client_readiness,
        client_unready=_decode_str_list(r.client_unready_json),
        scope_changes=_decode_scope_changes(r.scope_changes_json),
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
        .limit(5000)  # bound the per-job scan; real inventories are far smaller
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
        "last_edited_by_name": report.last_edited_by_name,
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
        "variance_causes": _decode_variance_causes(report) or [],
        "variance_note": report.variance_note or "",
        "variance_direction": report.variance_direction or "",
        "variance_cause_identified": report.variance_cause_identified,
        "client_readiness": report.client_readiness or "",
        "client_unready": _decode_str_list(report.client_unready_json) or [],
        "scope_changes": [c.model_dump() for c in (_decode_scope_changes(report.scope_changes_json) or [])],
        "hours_verified": bool(report.hours_verified),
        "employee_hours": [e.model_dump() for e in employees] if employees else [],
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }
    run_export_in_background(export_job_report_to_sheets, payload)


def _is_skill_rater(user: User) -> bool:
    """Skill ratings are editable only by admins and admin-designated skill raters
    (users.is_skill_rater). The crew_lead role does NOT grant this on its own
    (ADR 0014) - rating is deliberately a smaller group than the leads. Enforced
    server-side so a stale or tampered client can't persist skill edits from a
    regular crew member.

    Job type is NOT covered by this gate: see the note in upsert_job_report."""
    return user.role == "admin" or bool(getattr(user, "is_skill_rater", False))


@router.post("", response_model=JobReportResponse)
def upsert_job_report(
    body: JobReportUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    existing = db.query(JobReport).filter(JobReport.job_uuid == body.job_uuid).first()

    # Non-raters can't create or change skill ratings. Keep whatever a rater
    # already saved on the existing report (matched by employee name) and drop
    # anything the non-rater's payload carries.
    #
    # `preserve_employee_hours` closes the bypass-by-omission hole: stripping the
    # rating fields off the entries the payload HAS does nothing if the payload
    # has no entries at all. A non-rater posting an empty employee_hours list
    # (delete every row in the editor and save) would otherwise write NULL over
    # employee_hours_json and take every rating a rater had set with it. So when
    # a non-rater sends nothing, we keep what is already stored rather than
    # letting an empty payload erase it.
    preserve_employee_hours = False
    if not _is_skill_rater(current_user):
        if body.employee_hours:
            # Key prior entries by roster user_id where the row has one, and fall
            # back to the name for legacy rows. Keying on name alone meant renaming
            # somebody in the roster silently detached them from their own ratings.
            def _key(e) -> object:
                uid = getattr(e, "user_id", None)
                return ("id", uid) if isinstance(uid, int) else ("name", e.name)

            prior_by_key: dict = {}
            if existing:
                prior = _decode_employee_hours(existing.employee_hours_json) or []
                prior_by_key = {_key(e): e for e in prior}
            for entry in body.employee_hours:
                keep = prior_by_key.get(_key(entry))
                entry.skill_ratings = keep.skill_ratings if keep else None
                entry.skill_rating = keep.skill_rating if keep else None
        elif existing and existing.employee_hours_json:
            preserve_employee_hours = True
        # Job type is deliberately NOT gated. It was, briefly, on the reasoning
        # that it decides which skills get rated. But it is also the job's basic
        # descriptive data, and gating it meant a job with no designated rater on
        # site recorded no job type at all. Collecting it always beats collecting
        # it only when the right person happens to be on the crew, so any crew
        # member sets it. Only the skill ratings above are held back.

    if preserve_employee_hours:
        employee_hours_json = existing.employee_hours_json
    else:
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

    client_unready_json = (
        json.dumps(body.client_unready) if body.client_unready else None
    )
    variance_causes_json = (
        json.dumps(body.variance_causes) if body.variance_causes else None
    )
    scope_changes_json = (
        json.dumps([c.model_dump() for c in body.scope_changes])
        if body.scope_changes
        else None
    )

    if existing:
        # submitted_by_* is deliberately NOT touched here. It records who filed
        # the report, not who last saved it. Reassigning it on every update meant
        # an admin who opened a closed job and saved anything - or saved nothing
        # and just re-submitted the same values - became "the person who
        # submitted the report" despite never being on the job.
        #
        # The one exception is a row that has no submitter at all, which can only
        # come from data written before this column was populated. Claiming it
        # for the current user would be inventing a fact, so it is left null.
        existing.last_edited_by_id = current_user.id
        existing.last_edited_by_name = current_user.name or current_user.email
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
        # Write the list; clear the legacy singular column so a report that
        # predates multi-select cannot keep answering from two places at once
        # (_decode_variance_causes prefers the JSON, but leaving a stale string
        # behind is a trap for the next person reading the table directly).
        existing.variance_causes_json = variance_causes_json
        existing.variance_cause = None
        existing.variance_note = body.variance_note
        existing.variance_direction = body.variance_direction
        existing.variance_cause_identified = body.variance_cause_identified
        existing.client_readiness = body.client_readiness
        existing.client_unready_json = client_unready_json
        existing.scope_changes_json = scope_changes_json
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
        variance_causes_json=variance_causes_json,
        variance_note=body.variance_note,
        variance_direction=body.variance_direction,
        variance_cause_identified=body.variance_cause_identified,
        client_readiness=body.client_readiness,
        client_unready_json=client_unready_json,
        scope_changes_json=scope_changes_json,
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
