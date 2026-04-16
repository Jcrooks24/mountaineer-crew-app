from __future__ import annotations

import json
import os
import time as _time
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

# NOTE: Google API libraries (httplib2, google-auth, googleapiclient) are intentionally
# NOT imported at module level. They are lazy-loaded inside each function that needs them.
# This keeps startup memory ~100-150MB lower on Render free tier, since these libraries
# are only pulled into memory when a Google API call actually occurs.

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

BASE_DIR = Path(__file__).resolve().parents[2]
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

LOCAL_TZ = ZoneInfo("America/Denver")
DB_TOKEN_KEY = "google_oauth_token"

_cached_creds = None
_cached_cal_service = None
_cached_sheets_service = None

_SSL_ERRORS = ("DECRYPTION_FAILED", "BAD_RECORD_MAC", "SSL", "ssl", "EOF occurred")


def _build_authorized_http(creds):
    import certifi
    import httplib2
    import google_auth_httplib2
    http = httplib2.Http(ca_certs=certifi.where())
    return google_auth_httplib2.AuthorizedHttp(creds, http=http)


def _ssl_retry(fn, max_attempts: int = 3):
    last_err: Exception | None = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as exc:
            msg = str(exc)
            if any(marker in msg for marker in _SSL_ERRORS):
                last_err = exc
                if attempt < max_attempts - 1:
                    _time.sleep(0.5 * (attempt + 1))
                    continue
            raise
    raise last_err  # type: ignore[misc]


def _load_token_from_db(db) -> Optional[str]:
    from app.db.models.system_config import SystemConfig
    row = db.query(SystemConfig).filter(SystemConfig.key == DB_TOKEN_KEY).first()
    return row.value if row and row.value else None


def _save_token_to_db(creds, db) -> None:
    from app.db.models.system_config import SystemConfig
    token_json = creds.to_json()
    row = db.query(SystemConfig).filter(SystemConfig.key == DB_TOKEN_KEY).first()
    if row:
        row.value = token_json
    else:
        db.add(SystemConfig(key=DB_TOKEN_KEY, value=token_json))
    db.commit()


def _creds_from_json(token_json: str):
    from google.oauth2.credentials import Credentials
    token_info = json.loads(token_json)
    return Credentials.from_authorized_user_info(token_info, SCOPES)


def _get_creds(db=None):
    from google.auth.transport.requests import Request
    global _cached_creds

    if _cached_creds and _cached_creds.valid:
        return _cached_creds

    token_json: Optional[str] = None
    source = "unknown"

    if db:
        token_json = _load_token_from_db(db)
        if token_json:
            source = "db"

    if not token_json:
        token_json = os.getenv("GOOGLE_OAUTH_TOKEN_JSON", "").strip() or None
        if token_json:
            source = "env"

    if token_json:
        try:
            creds = _creds_from_json(token_json)
        except Exception as e:
            raise RuntimeError(f"Token JSON is invalid ({source}): {e}") from e

        if not creds.valid:
            if creds.expired and creds.refresh_token:
                _ssl_retry(lambda: creds.refresh(Request()))
                if db:
                    _save_token_to_db(creds, db)
            else:
                raise RuntimeError(
                    "Google OAuth token is invalid and cannot be refreshed. "
                    "Paste a fresh token via Admin > Calendar."
                )

        _cached_creds = creds
        return creds

    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    else:
        creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            _ssl_retry(lambda: creds.refresh(Request()))
        else:
            if not CREDS_PATH.exists():
                raise RuntimeError(f"Missing credentials.json at: {CREDS_PATH}")
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")

    _cached_creds = creds
    return creds


def invalidate_cache() -> None:
    global _cached_creds, _cached_cal_service, _cached_sheets_service
    _cached_creds = None
    _cached_cal_service = None
    _cached_sheets_service = None


def get_calendar_service(db=None):
    from googleapiclient.discovery import build
    global _cached_cal_service
    if _cached_cal_service is not None:
        return _cached_cal_service
    creds = _get_creds(db)
    _cached_cal_service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    return _cached_cal_service


def get_sheets_service(db=None):
    from googleapiclient.discovery import build
    global _cached_sheets_service
    if _cached_sheets_service is not None:
        return _cached_sheets_service
    creds = _get_creds(db)
    _cached_sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    return _cached_sheets_service


def get_cal_status(db=None) -> dict:
    try:
        creds = _get_creds(db)
        expiry = creds.expiry.isoformat() if creds.expiry else None
        return {
            "ok": True,
            "valid": creds.valid,
            "expired": creds.expired,
            "expiry": expiry,
            "has_refresh_token": bool(creds.refresh_token),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def list_events_for_day(date_yyyy_mm_dd: str, calendar_id: str, db=None) -> List[Dict[str, Any]]:
    from googleapiclient.discovery import build
    day = datetime.fromisoformat(date_yyyy_mm_dd).date()
    start_local = datetime.combine(day, time(0, 0, 0), tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    creds = _get_creds(db)

    def _fetch():
        authorized_http = _build_authorized_http(creds)
        svc = build("calendar", "v3", http=authorized_http, cache_discovery=False)
        return (
            svc.events()
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

    resp = _ssl_retry(_fetch)
    items = resp.get("items", [])
    out: List[Dict[str, Any]] = []
    for it in items:
        start = it.get("start", {}).get("dateTime") or it.get("start", {}).get("date")
        out.append({
            "id": it.get("id"),
            "summary": it.get("summary") or "(no title)",
            "start": start,
        })
    return out
