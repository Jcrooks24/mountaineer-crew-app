"""
Admin router - protected by require_admin dependency.

Endpoints:
- GET  /api/admin/users              - list all users
- PATCH /api/admin/users/{user_id}   - update role or is_active
- GET  /api/admin/events/today       - geotagged events from today (for map)
"""

import json as _json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db.models.admin_entry_status import AdminEntryStatus
from app.db.models.admin_note import AdminNote
from app.db.models.dvir import DVIR
from app.db.models.event import Event
from app.db.models.job_bill import JobBill
from app.db.models.job_report import JobReport
from app.db.models.materials import MaterialsSubmission
from app.db.models.photo import Photo
from app.db.models.system_config import SystemConfig
from app.db.models.employee_tag import user_employee_tags
from app.db.models.user import User
from app.db.models.user_email_alias import UserEmailAlias
from app.db.session import get_db
from app.integrations.sheets_export import update_entry_status_in_sheets

DVIR_UNITS_KEY = "dvir_units"
DEFAULT_DVIR_UNITS = ["26INT", "24FR8", "16FORD"]
APP_THEME_KEY = "app_theme"


router = APIRouter(prefix="/api/admin", tags=["admin"])


class CalTokenRequest(BaseModel):
    token_json: str


class UserAdminResponse(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    phone: Optional[str] = None
    role: str
    is_active: bool
    is_skill_rater: bool = False
    tag_ids: List[int] = []
    alias_count: int = 0
    # Free-form text the crew maintains on their availability page. Surfaced
    # as a hover tooltip on the admin Month schedule view's employee column.
    scheduling_notes: str = ""

    class Config:
        from_attributes = True


class UpdateUserRequest(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None
    is_skill_rater: Optional[bool] = None
    name: Optional[str] = None
    phone: Optional[str] = None


def _tag_ids_by_user(db: Session) -> Dict[int, List[int]]:
    """One query for every (user_id, tag_id) pair → dict per user."""
    rows = db.execute(
        user_employee_tags.select()
    ).all()
    out: Dict[int, List[int]] = {}
    for r in rows:
        out.setdefault(r.user_id, []).append(r.tag_id)
    return out


def _alias_counts_by_user(db: Session) -> Dict[int, int]:
    """One query for the alias-count per user. Lets the Employees tab show
    'N aliases' inline without an N+1 fetch."""
    rows = db.query(UserEmailAlias.user_id).all()
    counts: Dict[int, int] = {}
    for (uid,) in rows:
        counts[uid] = counts.get(uid, 0) + 1
    return counts


def _user_with_tags(
    user: User, tag_ids: List[int], alias_count: int = 0
) -> UserAdminResponse:
    return UserAdminResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        role=user.role,
        is_active=user.is_active,
        is_skill_rater=bool(user.is_skill_rater),
        tag_ids=tag_ids,
        alias_count=alias_count,
        scheduling_notes=user.scheduling_notes or "",
    )


# ---------------------------
# List all users
# ---------------------------
@router.get("/users", response_model=list[UserAdminResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    users = db.query(User).order_by(User.id).all()
    tags_by_user = _tag_ids_by_user(db)
    alias_counts = _alias_counts_by_user(db)
    return [
        _user_with_tags(u, tags_by_user.get(u.id, []), alias_counts.get(u.id, 0))
        for u in users
    ]


# ---------------------------
# Update a user (role / access)
# ---------------------------
@router.patch("/users/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Role / access changes can't target your own account (lock-out guard);
    # contact fields (name/phone) are always editable.
    if (payload.is_active is not None or payload.role is not None) and user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role or access")

    if payload.is_active is not None:
        user.is_active = payload.is_active
    # Three roles: user (crew), crew_lead (hours verify), admin. Unknown values
    # are ignored so a bad client can't set a junk role. Note crew_lead does not
    # grant skill rating - that is the separate is_skill_rater designation below.
    if payload.role is not None and payload.role in ("user", "crew_lead", "admin"):
        user.role = payload.role
    # Skill-rating designation (independent of role, see ADR 0014). No
    # self-lockout concern since it grants a capability rather than removing
    # access.
    if payload.is_skill_rater is not None:
        user.is_skill_rater = payload.is_skill_rater
    if payload.name is not None:
        user.name = payload.name.strip() or None
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None

    db.commit()
    db.refresh(user)
    tag_ids = _tag_ids_by_user(db).get(user.id, [])
    alias_count = _alias_counts_by_user(db).get(user.id, 0)
    return _user_with_tags(user, tag_ids, alias_count)


# ---------------------------
# Google Calendar OAuth status
# ---------------------------
@router.get("/cal-status")
def cal_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.core.google_cal_oauth import get_cal_status
    return get_cal_status(db)


@router.post("/cal-token", status_code=204)
def update_cal_token(
    payload: CalTokenRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Paste a fresh token.json body here to update the stored Google OAuth token."""
    import json as _json
    from app.core.google_cal_oauth import _save_token_to_db, invalidate_cache, _creds_from_json

    try:
        _json.loads(payload.token_json)  # validate JSON
        creds = _creds_from_json(payload.token_json)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid token JSON: {e}")

    if not creds.refresh_token:
        raise HTTPException(status_code=400, detail="Token has no refresh_token - run the OAuth flow with access_type=offline")

    _save_token_to_db(creds, db)
    invalidate_cache()


# ---------------------------
# Today's geotagged events
# ---------------------------
@router.get("/events/today")
def events_today(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    # "Today" is the Mountain calendar day - Bozeman is where crew operate.
    # Using UTC start-of-day silently dropped early-afternoon-MT events from
    # the map after 6 PM MT (when UTC midnight rolled over).
    from app.core.time_utils import mountain_day_utc_bounds
    start_of_day, end_of_day = mountain_day_utc_bounds()

    # Cap the day's geotagged events so a runaway location-ping device
    # can't materialize tens of thousands of ORM objects in this worker.
    # 2000 is well past any realistic crew day - if we ever brush the cap
    # we'll see it in the admin map and can paginate properly.
    events = (
        db.query(Event)
        .filter(
            Event.timestamp >= start_of_day,
            Event.timestamp < end_of_day,
            Event.lat.isnot(None),
            Event.lng.isnot(None),
        )
        .order_by(Event.timestamp.desc())
        .limit(2000)
        .all()
    )

    return [
        {
            "event_id": e.event_id,
            "job_uuid": e.job_uuid,
            "job_name": e.job_name or "",
            "type": e.type,
            "timestamp": e.timestamp.isoformat() + "Z",
            "lat": e.lat,
            "lng": e.lng,
            "note": e.note,
        }
        for e in events
    ]


# ---------------------------
# DVIR unit options config
# ---------------------------

class DVIRUnitsRequest(BaseModel):
    units: List[str]


@router.get("/config/dvir-units")
def get_dvir_units(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(SystemConfig).filter(SystemConfig.key == DVIR_UNITS_KEY).first()
    units = _json.loads(row.value) if row and row.value else DEFAULT_DVIR_UNITS
    return {"units": units}


@router.put("/config/dvir-units", status_code=204)
def set_dvir_units(
    payload: DVIRUnitsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    units = [u.strip() for u in payload.units if u.strip()]
    if not units:
        raise HTTPException(status_code=400, detail="At least one unit is required")
    row = db.query(SystemConfig).filter(SystemConfig.key == DVIR_UNITS_KEY).first()
    if row:
        row.value = _json.dumps(units)
    else:
        db.add(SystemConfig(key=DVIR_UNITS_KEY, value=_json.dumps(units)))
    db.commit()


# ---------------------------
# App-wide theme config
# ---------------------------

@router.put("/config/theme", status_code=204)
async def set_app_theme(
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Save the current theme settings so they apply globally to all users."""
    body = await request.json()
    value = _json.dumps(body)
    row = db.query(SystemConfig).filter(SystemConfig.key == APP_THEME_KEY).first()
    if row:
        row.value = value
    else:
        db.add(SystemConfig(key=APP_THEME_KEY, value=value))
    db.commit()


# ---------------------------
# Job search - by date + name, returns candidate job_uuids
# ---------------------------

@router.get("/job-search")
def job_search(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (event date or materials job_date)"),
    name: Optional[str] = Query(None, description="Partial, case-insensitive match on job_name"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Find candidate jobs for the Job Summary view without needing a UUID.

    A "job" here is any job_uuid that appears in events or materials with a
    matching date/name. Admins rarely remember the UUID, but they do know
    the date and the customer name.
    """
    from app.core.time_utils import mountain_date_expr, utc_naive_to_mountain_date

    needle = (name or "").strip().lower()
    candidates: Dict[str, Dict[str, Any]] = {}

    # Events - date comes from timestamp, evaluated in Mountain. The admin
    # types a `date` in their head as the calendar day in Bozeman; using
    # `func.date(Event.timestamp)` against a UTC-naive column would miss
    # late-evening-MT events that fell on the next UTC day.
    eq = db.query(Event).filter(Event.job_uuid.isnot(None))
    if date:
        eq = eq.filter(mountain_date_expr(Event.timestamp) == date)
    if needle:
        eq = eq.filter(func.lower(Event.job_name).like(f"%{needle}%"))
    for e in eq.limit(500).all():
        c = candidates.setdefault(e.job_uuid, {"names": [], "dates": set(), "events": 0, "materials": 0})
        if e.job_name:
            c["names"].append(e.job_name)
        if e.timestamp:
            c["dates"].add(utc_naive_to_mountain_date(e.timestamp).isoformat())
        c["events"] += 1

    # Materials - date comes from job_date (YYYY-MM-DD string)
    mq = db.query(MaterialsSubmission).filter(MaterialsSubmission.job_uuid.isnot(None))
    if date:
        mq = mq.filter(MaterialsSubmission.job_date == date)
    if needle:
        mq = mq.filter(func.lower(MaterialsSubmission.job_name).like(f"%{needle}%"))
    for m in mq.limit(500).all():
        c = candidates.setdefault(m.job_uuid, {"names": [], "dates": set(), "events": 0, "materials": 0})
        if m.job_name:
            c["names"].append(m.job_name)
        if m.job_date:
            c["dates"].add(m.job_date)
        c["materials"] += 1

    # One bulk lookup for the data-entry checkpoint chip - beats N queries
    # if the search ever returns a long candidate list.
    candidate_uuids = list(candidates.keys())
    entered_uuids: set[str] = set()
    if candidate_uuids:
        rows = (
            db.query(AdminEntryStatus.job_uuid)
            .filter(AdminEntryStatus.job_uuid.in_(candidate_uuids))
            .all()
        )
        entered_uuids = {r[0] for r in rows}

    results: List[Dict[str, Any]] = []
    for job_uuid, c in candidates.items():
        names = c["names"]
        best_name = max(set(names), key=names.count) if names else ""
        dates_sorted = sorted(c["dates"])
        results.append({
            "job_uuid": job_uuid,
            "job_name": best_name,
            "dates": dates_sorted,
            "event_count": c["events"],
            "material_count": c["materials"],
            "entered": job_uuid in entered_uuids,
        })

    # Newest first by latest known date
    results.sort(key=lambda r: (r["dates"][-1] if r["dates"] else "", r["job_name"]), reverse=True)
    return results[:limit]


# ---------------------------
# Per-job summary (all sources collated by job_uuid)
# ---------------------------

def _iso(dt: Any) -> Optional[str]:
    """Serialize a datetime for the JSON response. Naive datetimes in this
    app are stored as UTC; emit them with a trailing 'Z' so the browser
    doesn't reinterpret the bare ISO string in its local timezone - that's
    what was making Job Summary show events 6h off from the Timeline tab.
    """
    if dt is None:
        return None
    if isinstance(dt, datetime):
        s = dt.isoformat()
        if dt.tzinfo is None:
            s += "Z"
        return s
    if hasattr(dt, "isoformat"):
        # date / time objects - no timezone applies, return as-is.
        return dt.isoformat()
    return str(dt)


@router.get("/job-summary/{job_uuid}")
def job_summary(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    """Aggregate everything the app has collected for one job into a single
    admin-facing payload. Returns lists even when empty so the UI can render
    consistently. Resource shapes mirror what each source router returns but
    trimmed to fields useful for reviewing a job end-to-end.

    Per-source lists are capped to keep the response bounded - a single job
    has never come close to these limits in practice, but an unbounded
    `.all()` here was a memory cliff if a job's data ever drifted large
    (e.g., a long-running ongoing job, or a buggy duplicate-event flood).
    """
    # Cap per-source pulls. The full source data is always available via the
    # individual routers (or the Google Sheet) if a job somehow exceeds these.
    JOB_SUMMARY_CAP = 1000
    events = (
        db.query(Event)
        .filter(Event.job_uuid == job_uuid)
        .order_by(Event.timestamp.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    dvirs = (
        db.query(DVIR)
        .filter(DVIR.job_uuid == job_uuid)
        .order_by(DVIR.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    materials = (
        db.query(MaterialsSubmission)
        .filter(MaterialsSubmission.job_uuid == job_uuid)
        .order_by(MaterialsSubmission.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    report = (
        db.query(JobReport)
        .filter(JobReport.job_uuid == job_uuid)
        .first()
    )
    bill = (
        db.query(JobBill)
        .filter(JobBill.job_uuid == job_uuid)
        .first()
    )
    entry_status = (
        db.query(AdminEntryStatus)
        .filter(AdminEntryStatus.job_uuid == job_uuid)
        .first()
    )
    photos = (
        db.query(Photo)
        .filter(Photo.job_uuid == job_uuid)
        .order_by(Photo.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    admin_notes = (
        db.query(AdminNote)
        .filter(AdminNote.job_uuid == job_uuid)
        .order_by(AdminNote.updated_at.desc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )

    # Pick the most-common job_name from events/materials so the header reads cleanly.
    name_candidates: List[str] = []
    for e in events:
        if e.job_name:
            name_candidates.append(e.job_name)
    for m in materials:
        if m.job_name:
            name_candidates.append(m.job_name)
    job_name = max(set(name_candidates), key=name_candidates.count) if name_candidates else ""

    return {
        "job_uuid": job_uuid,
        "job_name": job_name,
        "events": [
            {
                "event_id": e.event_id,
                "type": e.type,
                "timestamp": _iso(e.timestamp),
                "logged_at": _iso(e.logged_at),
                "note": e.note,
                "lat": e.lat,
                "lng": e.lng,
                "created_by": e.created_by,
            }
            for e in events
        ],
        "dvirs": [
            {
                "dvir_id": d.dvir_id,
                "inspection_type": d.inspection_type,
                "inspection_date": d.inspection_date,
                "vehicle_number": d.vehicle_number,
                "trailer_number": d.trailer_number,
                "condition": d.condition,
                "defects": _json.loads(d.defects_json) if d.defects_json else [],
                "defect_notes": d.defect_notes,
                "driver_name": d.driver_name,
                "mechanic_name": d.mechanic_name,
                "mechanic_signed_at": _iso(d.mechanic_signed_at),
                "created_at": _iso(d.created_at),
            }
            for d in dvirs
        ],
        "materials": [
            {
                "id": m.submission_id,
                "created_at": _iso(m.created_at),
                "notes": m.notes or "",
                "items": _json.loads(m.items_json or "[]"),
                "total": float(m.total or 0),
            }
            for m in materials
        ],
        "job_report": None if not report else {
            "submitted_by_name": report.submitted_by_name,
            "personal_vehicles": report.personal_vehicles,
            "dumpster_pct": report.dumpster_pct,
            "recycling_pct": report.recycling_pct,
            "billing_method": report.billing_method,
            "review_candidate": report.review_candidate,
            "hours_match": report.hours_match,
            "hours_mismatch_reason": report.hours_mismatch_reason,
            "employee_hours": _json.loads(report.employee_hours_json or "[]") or [],
            "created_at": _iso(report.created_at),
            "updated_at": _iso(report.updated_at),
        },
        "bill": None if not bill else {
            "saved_by_name": bill.saved_by_name,
            "items": _json.loads(bill.items_json or "[]"),
            "global_discount": float(bill.global_discount or 0),
            "notes": bill.notes or "",
            "updated_at": _iso(bill.updated_at),
        },
        "photos": [
            {
                "id": p.id,
                "caption": p.caption,
                "drive_url": p.drive_url,
                "created_by": p.created_by,
                "created_at": _iso(p.created_at),
            }
            for p in photos
        ],
        "admin_notes": [
            {
                "id": n.id,
                "title": n.title,
                "body": n.body,
                "created_by_name": n.created_by_name,
                "updated_at": _iso(n.updated_at),
            }
            for n in admin_notes
        ],
        "entry_status": None if not entry_status else {
            "entered_by": entry_status.entered_by,
            "entered_on": entry_status.entered_on,
            "updated_by_name": entry_status.updated_by_name,
            "updated_at": _iso(entry_status.updated_at),
        },
    }


# ---------------------------
# Admin data-entry status - initials + date the admin records once they've
# transcribed a job's data into the books. Surfaced on the Job Summary card,
# in job-search results, and as new entered_by / entered_on columns on every
# job-related worksheet (Events, Materials, JobReports, Bills).
# ---------------------------

class EntryStatusUpsert(BaseModel):
    entered_by: str
    entered_on: str  # YYYY-MM-DD


@router.get("/job-entry-status/{job_uuid}")
def get_entry_status(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    row = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
    if not row:
        return {"job_uuid": job_uuid, "entry_status": None}
    return {
        "job_uuid": job_uuid,
        "entry_status": {
            "entered_by": row.entered_by,
            "entered_on": row.entered_on,
            "updated_by_name": row.updated_by_name,
            "updated_at": _iso(row.updated_at),
        },
    }


@router.put("/job-entry-status/{job_uuid}")
def upsert_entry_status(
    job_uuid: str,
    payload: EntryStatusUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Dict[str, Any]:
    initials = (payload.entered_by or "").strip()
    if not initials:
        raise HTTPException(status_code=400, detail="entered_by is required")
    entered_on = (payload.entered_on or "").strip()
    if not entered_on:
        raise HTTPException(status_code=400, detail="entered_on is required")

    now = datetime.now(timezone.utc)
    existing = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
    if existing:
        existing.entered_by = initials
        existing.entered_on = entered_on
        existing.updated_by_id = current_user.id
        existing.updated_by_name = current_user.name or current_user.email
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        row = existing
    else:
        row = AdminEntryStatus(
            job_uuid=job_uuid,
            entered_by=initials,
            entered_on=entered_on,
            updated_by_id=current_user.id,
            updated_by_name=current_user.name or current_user.email,
            updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    # Sweep historical sheet rows so admin sees the initials propagate
    # immediately. New writes (post this point) also pick the values up via
    # _entry_status_for in the exporter functions.
    sweep_counts: Dict[str, int] = {}
    try:
        sweep_counts = update_entry_status_in_sheets(db, job_uuid, initials, entered_on)
    except Exception as exc:
        # Log and continue - the DB row is the source of truth; the next
        # export of any kind for this job will repopulate. Admin can also
        # PUT again to retry.
        print(f"[entry-status] sweep failed for {job_uuid}: {exc}")

    return {
        "job_uuid": job_uuid,
        "entry_status": {
            "entered_by": row.entered_by,
            "entered_on": row.entered_on,
            "updated_by_name": row.updated_by_name,
            "updated_at": _iso(row.updated_at),
        },
        "sheet_sweep": sweep_counts,
    }


# ---------------------------
# Sheet reconciliation - recover events durable in Postgres but missing
# from the Events sheet because their original sync's sheet append failed.
# Idempotent: re-running is safe; the existing dedupe table covers it.
# ---------------------------

class ReconcileEventsRequest(BaseModel):
    batch_size: Optional[int] = None
    max_events: Optional[int] = None


@router.post("/crew-resources/refresh")
def crew_resources_refresh_endpoint(
    days_ahead: int = Query(default=14, ge=0, le=60),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Force a Crew Resources event refresh for today + days_ahead. Useful
    right after admin enables CREW_RESOURCES_ENABLED or re-authorizes
    Google OAuth - otherwise the next scheduled refresh is an hour away."""
    from app.integrations.crew_resources_calendar import (
        update_crew_resources_for_horizon,
    )
    results = update_crew_resources_for_horizon(db, days_ahead=days_ahead)
    return {
        "ok": True,
        "days": len(results),
        "succeeded": sum(1 for r in results if r.get("ok")),
        "results": results,
    }


@router.get("/crew-resources/status")
def crew_resources_status_endpoint(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Read-only diagnostic for the Crew Resources feature. Tells admin in
    one place whether the env vars are wired, the OAuth token has the
    write scope, and which calendar IDs are in effect - so debugging
    "events aren't showing up" doesn't require Render-log spelunking."""
    from app.core.google_cal_oauth import get_cal_status
    from app.integrations.crew_resources_calendar import (
        _is_enabled,
        _resources_calendar_id,
        _jobs_calendar_id,
    )
    cal = get_cal_status(db)
    return {
        "enabled": _is_enabled(),
        "resources_calendar_id_set": bool(_resources_calendar_id()),
        "jobs_calendar_id_set": bool(_jobs_calendar_id()),
        "oauth": {
            "ok": cal.get("ok", False),
            "valid": cal.get("valid"),
            "expired": cal.get("expired"),
            "has_refresh_token": cal.get("has_refresh_token"),
            "scopes": cal.get("scopes", []),
            "has_calendar_read": cal.get("has_calendar_read", False),
            "has_calendar_write": cal.get("has_calendar_write", False),
            "error": cal.get("error"),
        },
    }


@router.post("/sheets/reconcile-events")
def reconcile_events_endpoint(
    payload: ReconcileEventsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.integrations.sheets_reconcile import reconcile_events

    batch_size = payload.batch_size if payload.batch_size and payload.batch_size > 0 else 200
    max_events = payload.max_events if payload.max_events and payload.max_events > 0 else 2000
    # Hard ceiling so a malformed admin call can't pin a worker.
    batch_size = min(batch_size, 500)
    max_events = min(max_events, 10000)

    result = reconcile_events(db, batch_size=batch_size, max_events=max_events)
    return {"ok": True, **result}


# ---------------------------
# App Health - snapshot of critical functions for the Settings tab. Each
# check is independently try/excepted so one failing probe doesn't blank
# the whole report. Frontend renders this as plain text.
# ---------------------------


def _check_db(db: Session) -> Dict[str, str]:
    try:
        db.execute(text("SELECT 1")).scalar()
        return {"name": "Database", "status": "ok", "detail": "reachable"}
    except Exception as ex:
        return {"name": "Database", "status": "fail", "detail": f"{ex}"}


def _check_google_creds(db: Session) -> Dict[str, str]:
    try:
        from app.core.google_cal_oauth import _get_creds
        creds = _get_creds(db)
        if not creds:
            return {"name": "Google credentials", "status": "fail", "detail": "no token configured"}
        if not creds.refresh_token:
            return {"name": "Google credentials", "status": "warn", "detail": "no refresh token - re-auth needed soon"}
        if creds.expired and not creds.refresh_token:
            return {"name": "Google credentials", "status": "fail", "detail": "token expired and cannot refresh"}
        expiry = creds.expiry.isoformat() if creds.expiry else "unknown"
        return {"name": "Google credentials", "status": "ok", "detail": f"valid (expires {expiry})"}
    except Exception as ex:
        return {"name": "Google credentials", "status": "fail", "detail": f"{ex}"}


def _check_sheets_api(db: Session) -> Dict[str, str]:
    """Touch the configured spreadsheet to confirm Sheets API + access work
    end-to-end. Cheapest call is a metadata get with grid data off."""
    try:
        from app.core.google_cal_oauth import _build_authorized_http, _get_creds, _ssl_retry
        from googleapiclient.discovery import build as _build
        spreadsheet_id = os.getenv(
            "GOOGLE_SHEETS_SPREADSHEET_ID",
            "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs",
        ).strip()
        authorized_http = _build_authorized_http(_get_creds(db))
        svc = _build("sheets", "v4", http=authorized_http, cache_discovery=False)
        meta = _ssl_retry(lambda: svc.spreadsheets().get(
            spreadsheetId=spreadsheet_id, includeGridData=False
        ).execute())
        title = meta.get("properties", {}).get("title", "(unknown)")
        tab_count = len(meta.get("sheets", []))
        return {
            "name": "Google Sheets API",
            "status": "ok",
            "detail": f"reachable - sheet '{title}', {tab_count} tabs",
        }
    except Exception as ex:
        return {"name": "Google Sheets API", "status": "fail", "detail": f"{ex}"}


def _check_drive_api(db: Session) -> Dict[str, str]:
    """A trivial about.get on Drive confirms the drive.file scope works."""
    try:
        from app.core.google_cal_oauth import _build_authorized_http, _get_creds, _ssl_retry
        from googleapiclient.discovery import build as _build
        authorized_http = _build_authorized_http(_get_creds(db))
        svc = _build("drive", "v3", http=authorized_http, cache_discovery=False)
        # `about.get` requires a fields mask; "user/emailAddress" is the
        # cheapest meaningful read and surfaces auth issues immediately.
        info = _ssl_retry(lambda: svc.about().get(fields="user/emailAddress").execute())
        email = info.get("user", {}).get("emailAddress", "(unknown)")
        return {"name": "Google Drive API", "status": "ok", "detail": f"reachable as {email}"}
    except Exception as ex:
        return {"name": "Google Drive API", "status": "fail", "detail": f"{ex}"}


def _check_event_drift(db: Session) -> Dict[str, str]:
    try:
        from app.integrations.sheets_reconcile import count_unexported_events
        n = count_unexported_events(db)
        if n == 0:
            return {"name": "Sheet drift - events", "status": "ok", "detail": "0 missing"}
        # Below 25 is normal background noise on a busy day if a sync just
        # failed and a refresh is queued. Above that suggests a real outage.
        status = "warn" if n < 25 else "fail"
        return {
            "name": "Sheet drift - events",
            "status": status,
            "detail": f"{n} events missing from sheet - run Refresh",
        }
    except Exception as ex:
        return {"name": "Sheet drift - events", "status": "fail", "detail": f"{ex}"}


def _check_event_freshness(db: Session) -> Dict[str, str]:
    try:
        latest = db.query(func.max(Event.timestamp)).scalar()
        if latest is None:
            return {"name": "Event freshness", "status": "warn", "detail": "no events recorded yet"}
        # Treat naive timestamps as UTC - that's what /api/sync stores.
        if latest.tzinfo is None:
            latest_utc = latest.replace(tzinfo=timezone.utc)
        else:
            latest_utc = latest.astimezone(timezone.utc)
        delta = datetime.now(timezone.utc) - latest_utc
        hours = delta.total_seconds() / 3600.0
        human = (
            f"{int(delta.total_seconds() // 60)} min ago" if hours < 1
            else f"{hours:.1f} h ago"
        )
        if hours > 168:  # > 7 days
            return {"name": "Event freshness", "status": "fail", "detail": f"latest event {human}"}
        if hours > 24:
            return {"name": "Event freshness", "status": "warn", "detail": f"latest event {human}"}
        return {"name": "Event freshness", "status": "ok", "detail": f"latest event {human}"}
    except Exception as ex:
        return {"name": "Event freshness", "status": "fail", "detail": f"{ex}"}


def _check_env_vars() -> Dict[str, str]:
    """Surface env vars we know break the app if missing or stale. Doesn't
    leak values - only presence."""
    required = ["DATABASE_URL", "JWT_SECRET", "FRONTEND_URL", "GOOGLE_SHEETS_SPREADSHEET_ID"]
    missing = [k for k in required if not (os.getenv(k) or "").strip()]
    if not missing:
        return {"name": "Env vars", "status": "ok", "detail": "all required vars present"}
    # GOOGLE_SHEETS_SPREADSHEET_ID falls back to a default in code, so its
    # absence is a warning rather than a fail.
    fail_keys = [k for k in missing if k != "GOOGLE_SHEETS_SPREADSHEET_ID"]
    status = "fail" if fail_keys else "warn"
    return {"name": "Env vars", "status": status, "detail": f"missing: {', '.join(missing)}"}


@router.get("/health")
def app_health(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Server-side snapshot of app health. The Settings tab pairs this with
    its own client-side checks (offline state, queue size, etc.) and renders
    the merged result as plain text in a collapsible window."""
    checks: List[Dict[str, str]] = [
        _check_db(db),
        _check_env_vars(),
        _check_google_creds(db),
        _check_sheets_api(db),
        _check_drive_api(db),
        _check_event_drift(db),
        _check_event_freshness(db),
    ]
    worst = "ok"
    for c in checks:
        if c["status"] == "fail":
            worst = "fail"
            break
        if c["status"] == "warn" and worst != "fail":
            worst = "warn"
    return {
        "ok": True,
        "overall": worst,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
    }


@router.get("/system-check/sheets")
def system_check_sheets(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Advanced Settings health check: verify the Google Sheets connection and
    that every registered app->sheet sync has its worksheet tab (and flag env
    vars that aren't set). Covers all syncs via SHEET_SYNC_REGISTRY."""
    from app.integrations.sheets_export import check_sheets_sync
    return check_sheets_sync(db)
