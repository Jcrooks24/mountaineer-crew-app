from __future__ import annotations

from datetime import datetime, time
from pathlib import Path
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]


BASE_DIR = Path(__file__).resolve().parents[2]  # backend/
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

LOCAL_TZ = ZoneInfo("America/Denver")


def _get_creds() -> Credentials:
    """
    OAuth installed-app flow.
    First run opens a browser. Subsequent runs use token.json refresh token.
    """
    creds: Credentials | None = None

    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDS_PATH.exists():
                raise RuntimeError(f"Missing credentials.json at: {CREDS_PATH}")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)
            creds = flow.run_local_server(port=0)

        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    return creds


def list_events_for_day(date_yyyy_mm_dd: str, calendar_id: str) -> List[Dict[str, Any]]:
    """
    List events for a specific calendar on a local day (America/Denver).
    Returns {id, summary, start}.
    """
    day = datetime.fromisoformat(date_yyyy_mm_dd).date()
    start_local = datetime.combine(day, time(0, 0, 0), tzinfo=LOCAL_TZ)
    end_local = datetime.combine(day, time(23, 59, 59), tzinfo=LOCAL_TZ)

    creds = _get_creds()
    service = build("calendar", "v3", credentials=creds)

    resp = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=start_local.isoformat(),
            timeMax=end_local.isoformat(),
            singleEvents=True,
            orderBy="startTime",
            maxResults=250,
        )
        .execute()
    )

    items = resp.get("items", [])
    out: List[Dict[str, Any]] = []

    for it in items:
        start = it.get("start", {}).get("dateTime") or it.get("start", {}).get("date")
        out.append(
            {
                "id": it.get("id"),
                "summary": it.get("summary") or "(no title)",
                "start": start,
            }
        )

    return out
