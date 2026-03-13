"""
Admin router — protected by require_admin dependency.

Endpoints:
- GET  /api/admin/users              — list all users
- PATCH /api/admin/users/{user_id}   — update role or is_active
- GET  /api/admin/events/today       — geotagged events from today (for map)
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db.models.event import Event
from app.db.models.user import User
from app.db.session import get_db


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
            "type": e.type,
            "timestamp": e.timestamp.isoformat(),
            "lat": e.lat,
            "lng": e.lng,
            "note": e.note,
        }
        for e in events
    ]
