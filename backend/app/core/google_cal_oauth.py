from __future__ import annotations

import json
import os
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

    Local dev (default):
      - reads credentials.json + token.json from disk
      - refreshes token and writes token.json

    Hosted demo (Render free tier):
      - reads GOOGLE_OAUTH_CREDENTIALS_JSON and GOOGLE_OAUTH_TOKEN_JSON from env
      - refreshes in-memory if needed (cannot persist without disk)
    """
    creds: Credentials | None = None

    creds_json_env = os.getenv("GOOGLE_OAUTH_CREDENTIALS_JSON", "").strip()
    token_json_env = os.getenv("GOOGLE_OAUTH_TOKEN_JSON", "").strip()

    using_env = bool(creds_json_env and token_json_env)

    if using_env:
        # Load token from env (authorized user info)
        try:
            token_info = json.loads(token_json_env)
        except Exception as e:
            raise RuntimeError("GOOGLE_OAUTH_TOKEN_JSON is not valid JSON") from e

        creds = Credentials.from_authorized_user_info(token_info, SCOPES)

        # Refresh if needed (cannot write back to env)
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                # If refresh_token is missing/invalid, you must paste a new token.json into env
                raise RuntimeError(
                    "OAuth token invalid and cannot be refreshed. Regenerate token.json locally and update GOOGLE_OAUTH_TOKEN_JSON."
                )

        return creds

    # ---- Local file mode ----
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

        # Persist token for local dev
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
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)

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
