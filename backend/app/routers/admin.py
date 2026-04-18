"""
Admin router — protected by require_admin dependency.

Endpoints:
- GET  /api/admin/users              — list all users
- PATCH /api/admin/users/{user_id}   — update role or is_active
- GET  /api/admin/events/today       — geotagged events from today (for map)
"""

import json as _json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db.models.admin_note import AdminNote
from app.db.models.dvir import DVIR
from app.db.models.event import Event
from app.db.models.job_bill import JobBill
from app.db.models.job_report import JobReport
from app.db.models.materials import MaterialsSubmission
from app.db.models.photo import Photo
from app.db.models.system_config import SystemConfig
from app.db.models.user import User
from app.db.session import get_db

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
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UpdateUserRequest(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = None


# ---------------------------
# List all users
# ---------------------------
@router.get("/users", response_model=list[UserAdminResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(User).order_by(User.id).all()


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
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot modify your own account")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role is not None and payload.role in ("user", "admin"):
        user.role = payload.role

    db.commit()
    db.refresh(user)
    return user


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
        raise HTTPException(status_code=400, detail="Token has no refresh_token — run the OAuth flow with access_type=offline")

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
    start_of_day = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    events = (
        db.query(Event)
        .filter(
            Event.timestamp >= start_of_day,
            Event.lat.isnot(None),
            Event.lng.isnot(None),
        )
        .order_by(Event.timestamp.desc())
        .all()
    )

    return [
        {
            "event_id": e.event_id,
            "job_uuid": e.job_uuid,
            "job_name": e.job_name or "",
            "type": e.type,
            "timestamp": e.timestamp.isoformat(),
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
# Per-job summary (all sources collated by job_uuid)
# ---------------------------

def _iso(dt: Any) -> Optional[str]:
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
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
    """
    events = (
        db.query(Event)
        .filter(Event.job_uuid == job_uuid)
        .order_by(Event.timestamp.asc())
        .all()
    )
    dvirs = (
        db.query(DVIR)
        .filter(DVIR.job_uuid == job_uuid)
        .order_by(DVIR.created_at.asc())
        .all()
    )
    materials = (
        db.query(MaterialsSubmission)
        .filter(MaterialsSubmission.job_uuid == job_uuid)
        .order_by(MaterialsSubmission.created_at.asc())
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
    photos = (
        db.query(Photo)
        .filter(Photo.job_uuid == job_uuid)
        .order_by(Photo.created_at.asc())
        .all()
    )
    admin_notes = (
        db.query(AdminNote)
        .filter(AdminNote.job_uuid == job_uuid)
        .order_by(AdminNote.updated_at.desc())
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
    }
