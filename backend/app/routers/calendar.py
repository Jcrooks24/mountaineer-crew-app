import os
from fastapi import APIRouter, HTTPException, Query

from app.core.google_cal_oauth import list_events_for_day

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
):
    cal_id = resolve_calendar_id(calendar_id)

    # If we fell back to primary because env is missing, we can still serve the request,
    # but we should inform the caller how to configure it.
    env_missing = not (os.getenv("WORKSPACE_CALENDAR_ID") or "").strip()
    try:
        events = list_events_for_day(date_yyyy_mm_dd=date, calendar_id=cal_id)
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
