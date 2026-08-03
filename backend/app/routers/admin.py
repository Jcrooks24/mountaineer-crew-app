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
from app.core.mailer import send_email
from app.core.company import COMPANY_FIELDS, COMPANY_INFO_KEY, merge_company
from app.db.models.admin_entry_status import AdminEntryStatus
from app.db.models.admin_note import AdminNote
from app.db.models.bol import DigitalBOL
from app.db.models.dvir import DVIR
from app.db.models.event import Event
from app.db.models.incident import Incident
from app.db.models.job_bill import JobBill
from app.db.models.job_inventory import JobInventoryItem
from app.db.models.job_report import JobReport
from app.db.models.long_distance import LdDay
from app.db.models.materials import MaterialsSubmission
from app.db.models.photo import Photo
from app.db.models.reimbursement import Reimbursement
from app.db.models.system_config import SystemConfig
from app.db.models.employee_tag import user_employee_tags
from app.db.models.user import User
from app.db.models.user_email_alias import UserEmailAlias
from app.db.session import get_db
from app.integrations.sheets_export import (
    _incident_photo_urls,
    update_entry_status_in_sheets,
)

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
# Vehicle-unit fleet registry (weight + dims for DOT compliance)
# ---------------------------

class VehicleUnitIn(BaseModel):
    name: str
    dry_weight_lbs: Optional[float] = None
    gvwr_lbs: Optional[float] = None
    length_ft: Optional[float] = None
    width_ft: Optional[float] = None
    height_ft: Optional[float] = None
    axle_capacities_lbs: List[float] = []
    notes: Optional[str] = None


class VehicleUnitsRequest(BaseModel):
    units: List[VehicleUnitIn]


@router.put("/config/vehicle-units", status_code=204)
def set_vehicle_units(
    payload: VehicleUnitsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin write for the fleet registry. Read is public via
    GET /api/config/vehicle-units so field screens (DVIR, BOL, weight flags)
    don't need an admin token."""
    from app.core.vehicle_units import VEHICLE_UNITS_KEY, normalize_units

    units = normalize_units([u.model_dump() for u in payload.units])
    if not units:
        raise HTTPException(status_code=400, detail="At least one named unit is required")
    row = db.query(SystemConfig).filter(SystemConfig.key == VEHICLE_UNITS_KEY).first()
    if row:
        row.value = _json.dumps(units)
    else:
        db.add(SystemConfig(key=VEHICLE_UNITS_KEY, value=_json.dumps(units)))
    db.commit()


# ---------------------------
# Payroll reimbursement rates (2f) - mileage $/mi, per-diem $/night. Admin-only
# read + write; the payroll summary reads them server-side. These are
# standardized reimbursement rates, not hourly wages (ADR 0033, amends 0029).
# ---------------------------

class PayrollRatesRequest(BaseModel):
    mileage_rate: float = 0.0
    per_diem_rate: float = 0.0


@router.get("/config/payroll-rates")
def get_payroll_rates(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, float]:
    from app.core.payroll_rates import PAYROLL_RATES_KEY, normalize_rates
    row = db.query(SystemConfig).filter(SystemConfig.key == PAYROLL_RATES_KEY).first()
    raw = None
    if row and row.value:
        try:
            raw = _json.loads(row.value)
        except (ValueError, TypeError):
            raw = None
    return normalize_rates(raw)


@router.put("/config/payroll-rates", status_code=204)
def set_payroll_rates(
    payload: PayrollRatesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.core.payroll_rates import PAYROLL_RATES_KEY, normalize_rates
    rates = normalize_rates(payload.model_dump())
    row = db.query(SystemConfig).filter(SystemConfig.key == PAYROLL_RATES_KEY).first()
    if row:
        row.value = _json.dumps(rates)
    else:
        db.add(SystemConfig(key=PAYROLL_RATES_KEY, value=_json.dumps(rates)))
    db.commit()


# ---------------------------
# Job checklist config (C3). Admin-editable items, each manual or bound to an
# AUTO signal, optionally limited to long-distance and/or job types. Crew read
# the list via the public GET /api/config/job-checklist.
# ---------------------------

class ChecklistItemIn(BaseModel):
    key: Optional[str] = None
    label: str
    auto_key: str = ""
    ld_only: bool = False
    job_types: List[str] = []


class JobChecklistRequest(BaseModel):
    items: List[ChecklistItemIn]


@router.get("/config/job-checklist")
def admin_get_job_checklist(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    from app.core.job_checklists import (
        JOB_CHECKLIST_KEY, normalize_items, default_items, AUTO_SIGNALS,
    )
    row = db.query(SystemConfig).filter(SystemConfig.key == JOB_CHECKLIST_KEY).first()
    items = normalize_items(_json.loads(row.value)) if row and row.value else default_items()
    if not items:
        items = default_items()
    return {"items": items, "auto_signals": AUTO_SIGNALS}


@router.put("/config/job-checklist", status_code=204)
def admin_set_job_checklist(
    payload: JobChecklistRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from app.core.job_checklists import JOB_CHECKLIST_KEY, normalize_items
    items = normalize_items([i.model_dump() for i in payload.items])
    row = db.query(SystemConfig).filter(SystemConfig.key == JOB_CHECKLIST_KEY).first()
    if row:
        row.value = _json.dumps(items)
    else:
        db.add(SystemConfig(key=JOB_CHECKLIST_KEY, value=_json.dumps(items)))
    db.commit()


# ---------------------------
# Company (carrier) information config
# ---------------------------

class CompanyInfoRequest(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    dot: Optional[str] = None
    mc: Optional[str] = None


@router.get("/config/company")
def get_company_info(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(SystemConfig).filter(SystemConfig.key == COMPANY_INFO_KEY).first()
    stored = _json.loads(row.value) if row and row.value else {}
    return merge_company(stored)


@router.put("/config/company", status_code=204)
def set_company_info(
    payload: CompanyInfoRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    # Store only the known fields; merge_company applies the defaults on read, so
    # a field left blank falls back rather than blanking the BOL carrier block.
    value = _json.dumps({k: (getattr(payload, k) or "") for k in COMPANY_FIELDS})
    row = db.query(SystemConfig).filter(SystemConfig.key == COMPANY_INFO_KEY).first()
    if row:
        row.value = value
    else:
        db.add(SystemConfig(key=COMPANY_INFO_KEY, value=value))
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

def _decode_json_list(raw: Optional[str]) -> list:
    """Decode a JSON-array text column, tolerating junk. A malformed blob must not
    take down the whole job summary: the point of this page is that admin can see a
    job whole, so one bad column degrades to an empty list rather than a 500."""
    if not raw:
        return []
    try:
        val = _json.loads(raw)
    except (ValueError, TypeError):
        return []
    return val if isinstance(val, list) else []


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

    # ── Sources added because the summary had fallen behind the app ──────────
    # Every feature below is keyed by job_uuid and was already reaching the Google
    # Sheet, but never reached this page, so admin had to open the sheet (or three
    # tabs of it) to see a job whole. Off-job hours, office hours and availability
    # are deliberately absent: they are not job-scoped and cannot be joined here.
    inventory_items = (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.job_uuid == job_uuid)
        .order_by(JobInventoryItem.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    incidents = (
        db.query(Incident)
        .filter(Incident.job_uuid == job_uuid)
        .order_by(Incident.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    bol = (
        db.query(DigitalBOL)
        .filter(DigitalBOL.job_uuid == job_uuid)
        .order_by(DigitalBOL.updated_at.desc())
        .first()
    )
    ld_days = (
        db.query(LdDay)
        .filter(LdDay.job_uuid == job_uuid)
        .order_by(LdDay.date.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )
    reimbursements = (
        db.query(Reimbursement)
        .filter(Reimbursement.job_uuid == job_uuid)
        .order_by(Reimbursement.created_at.asc())
        .limit(JOB_SUMMARY_CAP)
        .all()
    )

    # Tolerant decode: a corrupt JSON column must degrade to empty, not 500 the
    # whole summary page (the point of this endpoint is to show a job WHOLE).
    employee_hours = _decode_json_list(report.employee_hours_json) if report else []

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
                "defects": _decode_json_list(d.defects_json),
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
                "items": _decode_json_list(m.items_json),
                "total": float(m.total or 0),
            }
            for m in materials
        ],
        "job_report": None if not report else {
            "submitted_by_name": report.submitted_by_name,
            "personal_vehicles": report.personal_vehicles,
            "bill_personal_vehicles": bool(report.bill_personal_vehicles),
            "dumpster_pct": report.dumpster_pct,
            "recycling_pct": report.recycling_pct,
            "billing_method": report.billing_method,
            "review_candidate": report.review_candidate,
            "hours_match": report.hours_match,
            "hours_verified": bool(report.hours_verified),
            "hours_mismatch_reason": report.hours_mismatch_reason,
            # These all existed on the model and in the sheet, and none of them
            # reached this page. The job type in particular decides which skills
            # the crew were rated on, so a rating with no job type next to it is
            # not interpretable.
            "job_type_tags": _decode_json_list(report.job_type_tags_json),
            "truck_fullness": _decode_json_list(report.truck_fullness_json),
            "out_of_town": bool(report.out_of_town),
            "has_crew_feedback": report.has_crew_feedback,
            "crew_feedback": report.crew_feedback or "",
            "overage_note": report.overage_note or "",
            "employee_hours": employee_hours,
            "created_at": _iso(report.created_at),
            "updated_at": _iso(report.updated_at),
        },
        "inventory": {
            "furniture_count": sum(
                (it.qty or 0) for it in inventory_items if not it.is_box
            ),
            "box_count": sum((it.qty or 0) for it in inventory_items if it.is_box),
            "items": [
                {
                    "name": it.name,
                    "qty": it.qty,
                    "is_box": bool(it.is_box),
                    "pack_type": it.pack_type,
                    "room": it.room,
                    "notes": it.notes,
                    "created_by_name": it.created_by_name,
                }
                for it in inventory_items
            ],
        },
        "incidents": [
            {
                "incident_uuid": i.incident_uuid,
                "claim_number": i.claim_number,
                "incident_date": i.incident_date,
                "severity": i.severity,
                "attributable": i.attributable,
                "attributed_crew": i.attributed_crew,
                "description": i.description,
                "est_cost": float(i.est_cost) if i.est_cost is not None else None,
                "resolved": bool(i.resolved),
                "notes": i.notes,
                "reported_by_name": i.reported_by_name,
                # Same helper the sheet export uses: unions the photos table with
                # the incident's own snapshot, so a URL captured offline and never
                # re-uploaded is not lost, and it queries photos by incident_uuid
                # directly rather than filtering the job's photo list (which is
                # capped at 1000 - the incident's photos are attached later and
                # would be exactly the truncated ones on a busy job).
                "photo_urls": _incident_photo_urls(db, i.incident_uuid, _decode_json_list(i.photo_urls)),
                "created_at": _iso(i.created_at),
            }
            for i in incidents
        ],
        "bol": None if not bol else {
            "bol_id": bol.bol_id,
            "status": bol.status,
            "item_count": len(_decode_json_list(bol.items_json)),
            "inventory_verified": getattr(bol, "inventory_verified", None),
            "inventory_note": getattr(bol, "inventory_note", None),
            "signed_pdf_url": getattr(bol, "signed_pdf_url", None),
            "updated_at": _iso(bol.updated_at),
        },
        # Per-diem and drive days. $50/day/person, so admin needs the count, not
        # just the flag.
        "ld_days": [
            {
                "driver_name": ld.driver_name,
                "date": ld.date,
                "out_of_town": bool(ld.out_of_town),
                "drive_day": bool(ld.drive_day),
            }
            for ld in ld_days
        ],
        "reimbursements": [
            {
                "reimbursement_uuid": r.reimbursement_uuid,
                "type": r.type,
                "user_name": r.user_name,
                "amount": float(r.amount) if r.amount is not None else None,
                "category": r.category,
                "vendor": r.vendor,
                "status": r.status,
                "notes": r.notes,
                "created_at": _iso(r.created_at),
            }
            for r in reimbursements
        ],
        "bill": None if not bill else {
            "saved_by_name": bill.saved_by_name,
            "items": _decode_json_list(bill.items_json),
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
        "entry_status": _entry_status_json(entry_status) if entry_status else None,
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
    # The three-part attestation (ADR 0032). All must be true to record initials.
    validated: bool = False
    corrected: bool = False
    confirmed_in_sheet: bool = False


def _entry_status_json(row: AdminEntryStatus) -> Dict[str, Any]:
    return {
        "entered_by": row.entered_by,
        "entered_on": row.entered_on,
        "validated": bool(row.validated),
        "corrected": bool(row.corrected),
        "confirmed_in_sheet": bool(row.confirmed_in_sheet),
        "updated_by_name": row.updated_by_name,
        "updated_at": _iso(row.updated_at),
    }


@router.get("/job-entry-status/{job_uuid}")
def get_entry_status(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    row = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
    if not row:
        return {"job_uuid": job_uuid, "entry_status": None}
    return {"job_uuid": job_uuid, "entry_status": _entry_status_json(row)}


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
    # Initialing is a three-part attestation now (ADR 0032). All three must be
    # affirmed; the initials are the signature on that statement, so recording
    # them without it would be signing a claim that was never made.
    if not (payload.validated and payload.corrected and payload.confirmed_in_sheet):
        raise HTTPException(
            status_code=400,
            detail=(
                "Confirm all three - validated the record, made any corrections, "
                "and confirmed it landed in the Google Sheet - before initialing."
            ),
        )

    now = datetime.now(timezone.utc)
    existing = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
    if existing:
        existing.entered_by = initials
        existing.entered_on = entered_on
        existing.validated = True
        existing.corrected = True
        existing.confirmed_in_sheet = True
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
            validated=True,
            corrected=True,
            confirmed_in_sheet=True,
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

    # Initialing is what notifies crew of the corrections made on this job
    # (ADR 0032). Best-effort and non-raising - the checkpoint is saved above
    # regardless; the outcome is surfaced so the admin knows if a mail failed.
    notify: Dict[str, Any] = {"sent": [], "failed": [], "email_unconfigured": False}
    try:
        from app.routers.payroll import notify_job_corrections
        notify = notify_job_corrections(db, job_uuid)
    except Exception as exc:
        print(f"[entry-status] correction notify failed for {job_uuid}: {exc}")

    return {
        "job_uuid": job_uuid,
        "entry_status": _entry_status_json(row),
        "sheet_sweep": sweep_counts,
        "notify": notify,
    }


# ---------------------------
# Admin bill correction (2e). The office corrects the billing on a job - the
# bill invoice (line items, discount, notes) and the job-report billing fields -
# and the crew who worked it are emailed what changed. The bill is the office's
# invoice, not crew-sacred like hours, so this edits in place (no override
# layer); the pre-edit total is captured for the email. See docs ADR 0032 for
# the sibling hours flow and the same best-effort, non-raising notify contract.
# ---------------------------

def _bill_line_total(items: List[Dict[str, Any]], global_discount: float) -> float:
    """The bill total, computed exactly as the Job Summary shows it:
    sum(qty * rate * (1 - line_discount)) then the global discount."""
    subtotal = 0.0
    for it in items or []:
        try:
            qty = float(it.get("qty") or 0)
            rate = float(it.get("rate") or 0)
            disc = float(it.get("discount") or 0)
        except (TypeError, ValueError):
            continue
        subtotal += qty * rate * (1 - disc / 100.0)
    return subtotal * (1 - (global_discount or 0.0) / 100.0)


def _job_employee_recipients(db: Session, job_uuid: str) -> List[User]:
    """The crew on this job who can be emailed: the user_ids on the job report's
    employee hours, resolved to active roster rows with an address. A name with
    no user_id cannot be mailed and is simply skipped."""
    rep = (
        db.query(JobReport.employee_hours_json)
        .filter(JobReport.job_uuid == job_uuid)
        .first()
    )
    ids: set = set()
    if rep and rep[0]:
        try:
            for e in _json.loads(rep[0]) or []:
                if isinstance(e, dict) and isinstance(e.get("user_id"), int):
                    ids.add(e["user_id"])
        except (ValueError, TypeError):
            pass
    if not ids:
        return []
    return db.query(User).filter(User.id.in_(ids)).all()


class BillCorrectionRequest(BaseModel):
    # The corrected invoice.
    items: List[Dict[str, Any]]
    global_discount: float = 0.0
    notes: Optional[str] = None
    # The corrected job-report billing fields. None = leave that field as-is,
    # so the admin can correct the bill without touching the report or vice
    # versa. Only sent when the report exists.
    personal_vehicles: Optional[int] = None
    dumpster_pct: Optional[int] = None
    recycling_pct: Optional[int] = None
    billing_method: Optional[str] = None
    bill_personal_vehicles: Optional[bool] = None
    # Required: it is the body of the email the crew receives.
    reason: str
    notify: bool = True


def _bill_correction_email(
    employee_name: str, job_name: str, before: float, after: float, reason: str
) -> tuple:
    first = employee_name.split(" ")[0] if employee_name else "there"
    changed = abs(after - before) >= 0.005
    total_line = (
        f"The bill total changed from ${before:,.2f} to ${after:,.2f}.\n\n"
        if changed
        else "The bill total did not change.\n\n"
    )
    body = (
        f"Hi {first},\n\n"
        f"The billing on {job_name} was reviewed and corrected by the office.\n\n"
        + total_line
        + f"Reason: {reason}\n\n"
        "If any of this looks wrong, reply to this email or talk to the office.\n\n"
        "Mountaineer Moving\n"
    )
    return f"Billing correction for {job_name}", body


@router.post("/bill-correction/{job_uuid}")
def correct_bill(
    job_uuid: str,
    body: BillCorrectionRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=400,
            detail="A reason is required - the crew is emailed it.",
        )
    if len(reason) > 2000:
        raise HTTPException(status_code=400, detail="reason too long")

    now = datetime.now(timezone.utc)

    # ── Bill invoice ──
    existing = db.query(JobBill).filter(JobBill.job_uuid == job_uuid).first()
    before_total = _bill_line_total(
        _json.loads(existing.items_json or "[]") if existing else [],
        existing.global_discount if existing else 0.0,
    )
    after_total = _bill_line_total(body.items, body.global_discount)
    if existing:
        existing.items_json = _json.dumps(body.items)
        existing.global_discount = body.global_discount
        existing.notes = body.notes
        existing.saved_by_id = admin.id
        existing.saved_by_name = admin.name or admin.email
        existing.updated_at = now
        bill = existing
    else:
        bill = JobBill(
            job_uuid=job_uuid,
            items_json=_json.dumps(body.items),
            global_discount=body.global_discount,
            notes=body.notes,
            saved_by_id=admin.id,
            saved_by_name=admin.name or admin.email,
            created_at=now,
            updated_at=now,
        )
        db.add(bill)

    # ── Job-report billing fields ──
    report = db.query(JobReport).filter(JobReport.job_uuid == job_uuid).first()
    report_changed = False
    if report is not None:
        if body.personal_vehicles is not None and report.personal_vehicles != body.personal_vehicles:
            report.personal_vehicles = body.personal_vehicles
            report_changed = True
        if body.dumpster_pct is not None and report.dumpster_pct != body.dumpster_pct:
            report.dumpster_pct = body.dumpster_pct
            report_changed = True
        if body.recycling_pct is not None and report.recycling_pct != body.recycling_pct:
            report.recycling_pct = body.recycling_pct
            report_changed = True
        if body.billing_method is not None and report.billing_method != body.billing_method:
            report.billing_method = body.billing_method
            report_changed = True
        if body.bill_personal_vehicles is not None and bool(report.bill_personal_vehicles) != body.bill_personal_vehicles:
            report.bill_personal_vehicles = body.bill_personal_vehicles
            report_changed = True

    db.commit()
    db.refresh(bill)

    # ── Re-export the corrected records to the Sheet ──
    try:
        from app.routers.bill import _export_bill
        _export_bill(db, bill)
    except Exception as exc:
        print(f"[bill-correction] bill export failed for {job_uuid}: {exc}")
    if report is not None and report_changed:
        try:
            from app.routers.job_report import _export_report_to_sheets
            _export_report_to_sheets(db, report)
        except Exception as exc:
            print(f"[bill-correction] report export failed for {job_uuid}: {exc}")

    # ── Notify the job's crew ──
    notify: Dict[str, Any] = {"sent": [], "failed": [], "email_unconfigured": False}
    if body.notify:
        if not os.getenv("POSTMARK_SERVER_TOKEN", "").strip() or not os.getenv("SMTP_FROM", "").strip():
            notify["email_unconfigured"] = True
        else:
            job_name = (
                db.query(func.max(Event.job_name))
                .filter(Event.job_uuid == job_uuid)
                .scalar()
            ) or job_uuid[:8]
            for user in _job_employee_recipients(db, job_uuid):
                name = user.name or user.email
                if not user.email:
                    notify["failed"].append({
                        "user_id": user.id, "name": name,
                        "error": "no email address on the roster",
                    })
                    continue
                subject, textbody = _bill_correction_email(
                    name, job_name, before_total, after_total, reason,
                )
                try:
                    send_email(to_email=user.email, subject=subject, text=textbody)
                except Exception as exc:
                    notify["failed"].append({"user_id": user.id, "name": name, "error": str(exc)})
                    continue
                notify["sent"].append({"user_id": user.id, "name": name})

    return {
        "job_uuid": job_uuid,
        "bill": {
            "items": _json.loads(bill.items_json or "[]"),
            "global_discount": bill.global_discount or 0.0,
            "notes": bill.notes,
            "saved_by_name": bill.saved_by_name,
            "updated_at": _iso(bill.updated_at),
        },
        "report_billing": None if report is None else {
            "personal_vehicles": report.personal_vehicles,
            "dumpster_pct": report.dumpster_pct,
            "recycling_pct": report.recycling_pct,
            "billing_method": report.billing_method,
            "bill_personal_vehicles": bool(report.bill_personal_vehicles),
        },
        "before_total": round(before_total, 2),
        "after_total": round(after_total, 2),
        "notify": notify,
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


@router.post("/sheets/reconcile-bols")
def reconcile_bols_endpoint(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Ship any BOLs that are in Postgres but missing from the BOLs sheet tab
    (a scheduled export whose pool thread died). Idempotent. See ADR 0020."""
    from app.integrations.bol_reconcile import reconcile_bols

    result = reconcile_bols(db)
    return {"ok": True, **result}


@router.post("/bol/{bol_id}/reexport")
def force_reexport_bol_endpoint(
    bol_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Force a fresh sheet + Drive-link export of one BOL by id, even if it is
    already exported or its row is stale/blank. Recovery tool for a specific
    document; there was previously no way to force a re-export short of a real
    save. See ADR 0020."""
    from app.integrations.bol_reconcile import force_reexport_bol

    result = force_reexport_bol(db, bol_id)
    if not result.get("ok"):
        raise HTTPException(status_code=404, detail=result.get("error", "BOL not found"))
    return result


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


def _check_bol_drift(db: Session) -> Dict[str, str]:
    try:
        from app.integrations.bol_reconcile import count_unexported_bols
        n = count_unexported_bols(db)
        if n == 0:
            return {"name": "Sheet drift - BOLs", "status": "ok", "detail": "0 missing"}
        # BOLs are signed legal documents and low-volume - ANY missing one is
        # worth surfacing, so this warns from 1 (the auto-reconciler clears them
        # every cycle; a persistent count means something is wrong).
        return {
            "name": "Sheet drift - BOLs",
            "status": "warn",
            "detail": f"{n} BOLs in the database but missing from the sheet - the "
                      f"auto-reconciler clears these each cycle; a persistent count means "
                      f"something is wrong (POST /api/admin/sheets/reconcile-bols to force)",
        }
    except Exception as ex:
        return {"name": "Sheet drift - BOLs", "status": "fail", "detail": f"{ex}"}


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


def _check_sheet_record_drift(db: Session) -> Dict[str, str]:
    """Live DB-vs-Sheet record audit for ALL syncs, folded into app health so a
    single check answers "is the sheet an accurate mirror of the server?". This
    is the record-level counterpart to _check_event_drift / _check_bol_drift
    (which cover only the two reconciled syncs). WARN, never FAIL: a hole in the
    mirror is recoverable (Postgres is the system of record), and the backfill /
    auto-reconciler close it - it should nudge, not alarm."""
    try:
        from app.integrations.sheet_backfill import audit_sheet_backfill
        audit = audit_sheet_backfill(db)
        if not audit.get("connected"):
            return {"name": "Sheet record sync", "status": "warn",
                    "detail": f"could not audit: {audit.get('error') or 'not connected'}"}
        total = int(audit.get("total_missing", 0) or 0)
        if total == 0:
            return {"name": "Sheet record sync", "status": "ok",
                    "detail": "sheet mirrors the server - no missing records"}
        offenders = [
            (r["label"], r.get("missing_count", 0))
            for r in audit.get("results", [])
            if not r.get("auto") and r.get("missing_count", 0) > 0
        ]
        offenders.sort(key=lambda x: x[1], reverse=True)
        parts = "; ".join(f"{lbl}: {n}" for lbl, n in offenders[:6])
        more = "" if len(offenders) <= 6 else f" (+{len(offenders) - 6} more)"
        return {"name": "Sheet record sync", "status": "warn",
                "detail": f"{total} record(s) not in the sheet - {parts}{more}. "
                          f"Re-send from Sync & Accuracy."}
    except Exception as ex:  # noqa: BLE001 - a health check must never 500
        return {"name": "Sheet record sync", "status": "warn", "detail": f"audit failed: {ex}"}


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
        _check_bol_drift(db),
        _check_sheet_record_drift(db),
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


@router.get("/system-check/sheet-backfill")
def system_check_sheet_backfill(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Read-only audit: which records are in Postgres but never reached the
    Sheet. `check_sheets_sync` reports whether a sync is healthy *now*; this
    reports what the outages left behind, which that check cannot - it stores
    one status row per export function, not per record."""
    from app.integrations.sheet_backfill import audit_sheet_backfill
    return audit_sheet_backfill(db)


class SheetBackfillRequest(BaseModel):
    key: str
    # Omit to re-export everything the audit currently reports missing for this
    # sync; pass explicit ids to re-drive only those.
    ids: Optional[List[str]] = None


@router.post("/system-check/sheet-backfill")
def run_sheet_backfill(
    body: SheetBackfillRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Re-drive the real export for records the audit found missing. Idempotent:
    every export in the registry is replace- or dedupe-style, so re-running one
    for a record that is actually present overwrites in place rather than
    duplicating."""
    from app.integrations.sheet_backfill import reexport_missing
    result = reexport_missing(db, body.key, body.ids)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Backfill failed")
    return result
