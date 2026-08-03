import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.google_cal_oauth import list_event_invitee_emails, list_events_for_day
from app.core.deps import get_current_user
from app.db.models.user import User
from app.db.session import get_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def resolve_calendar_id(explicit: str | None) -> str:
    """
    Priority:
      1) explicit query param calendar_id=
      2) WORKSPACE_CALENDAR_ID env var
      3) fallback to 'primary' (dev-friendly)
    """
    if explicit and explicit.strip():
        return explicit.strip()

    env_id = os.getenv("WORKSPACE_CALENDAR_ID")
    if env_id and env_id.strip():
        return env_id.strip()

    # Dev-friendly default so the app doesn't hard-crash if you forgot env vars.
    return "primary"


@router.get("/day")
def get_events_for_day(
    date: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    calendar_id: str | None = Query(
        default=None,
        description="Optional override. If omitted, uses WORKSPACE_CALENDAR_ID or falls back to 'primary' in dev.",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cal_id = resolve_calendar_id(calendar_id)

    env_missing = not (os.getenv("WORKSPACE_CALENDAR_ID") or "").strip()
    try:
        events = list_events_for_day(date_yyyy_mm_dd=date, calendar_id=cal_id, db=db)
        resp = {"ok": True, "date": date, "calendar_id": cal_id, "events": events}
        if env_missing and (calendar_id is None):
            resp["warning"] = "WORKSPACE_CALENDAR_ID not set; using 'primary'. Set WORKSPACE_CALENDAR_ID for production."
        return resp
    except Exception as e:
        msg = str(e)
        if "invalid_grant" in msg:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Google OAuth token has expired or been revoked (invalid_grant). "
                    "Re-run the OAuth flow locally: cd backend && python -c \"from app.core.google_cal_oauth import _get_creds; _get_creds()\" "
                    "then copy the contents of token.json into the GOOGLE_OAUTH_TOKEN_JSON env var on Render."
                ),
            )
        raise HTTPException(status_code=500, detail=msg)


@router.get("/event-crew")
def get_event_crew(
    calendar_event_id: str = Query(..., description="Google Calendar event id"),
    calendar_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Crew suggestions for the job-setup capture screen (ADR 0034): the event's
    invitees matched to roster users by email, plus any that matched nobody.

    Best-effort - if the calendar is unreachable the screen just falls back to
    adding crew by hand, so this returns empty lists with a note rather than
    failing the whole setup flow."""
    from app.integrations.crew_resources_calendar import _email_to_user_id

    cal_id = resolve_calendar_id(calendar_id)
    try:
        emails = list_event_invitee_emails(calendar_event_id, cal_id, db=db)
    except Exception as e:
        return {"ok": False, "matched": [], "unmatched": [], "note": str(e)}

    email_to_uid = _email_to_user_id(db)
    matched: list[dict] = []
    unmatched: list[str] = []
    seen_uids: set = set()
    for email in emails:
        uid = email_to_uid.get(email)
        if uid is None:
            unmatched.append(email)
            continue
        if uid in seen_uids:
            continue
        seen_uids.add(uid)
        user = db.query(User).filter(User.id == uid).first()
        if user is None:
            unmatched.append(email)
            continue
        matched.append({
            "user_id": user.id,
            "name": user.name or user.email,
            "email": user.email,
        })
    return {"ok": True, "matched": matched, "unmatched": unmatched}
