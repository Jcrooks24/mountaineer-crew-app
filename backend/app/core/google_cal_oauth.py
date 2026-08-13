from __future__ import annotations

import json
import os
import threading
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
    # NOTE: do not add scopes here speculatively - google-auth sends the
    # full list on every token refresh, and any scope not in the original
    # grant trips Google's token endpoint with `invalid_scope`, breaking
    # every background sheets export until the user re-authorizes.
    #
    # calendar.events was added once the prod admin had re-authorized
    # locally with scripts/refresh_google_token_with_writes.py and pasted
    # the broader-scope token via /api/admin/cal-token. Without this entry,
    # every access-token refresh quietly dropped the events scope and PATCH
    # calls to Crew Resources events 403'd with insufficientPermissions an
    # hour after each paste.
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

BASE_DIR = Path(__file__).resolve().parents[2]
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

LOCAL_TZ = ZoneInfo("America/Denver")
DB_TOKEN_KEY = "google_oauth_token"

_cached_creds = None
_creds_lock = threading.Lock()

_SSL_ERRORS = ("DECRYPTION_FAILED", "BAD_RECORD_MAC", "SSL", "ssl", "EOF occurred")


# Seconds before a Google HTTP call gives up. httplib2 defaults to None, which
# means BLOCK FOREVER on the socket.
#
# That default is dangerous here specifically because of what sits behind it: the
# Sheets export pool is a ThreadPoolExecutor with max_workers=2. A stalled TLS
# read - a half-open connection after a network blip, routine on a cloud host -
# parks one of those two threads permanently. Two of them and the pool is wedged:
# every later export submit() just queues behind threads that will never return.
#
# The failure mode is SILENCE, which is why it is worth a constant and this
# comment. Nothing raises, so nothing reaches the failure ring; nothing succeeds,
# so no row appears; the backfill still reports work as "queued" because handing
# a task to a saturated pool succeeds. From the outside it is indistinguishable
# from "the export did nothing", and it survives until the worker is recycled.
#
# 60s is generous for a Sheets/Drive call (batch writes on a large tab are the
# slow case) and still bounded. A call that has not finished in a minute is not
# going to.
GOOGLE_HTTP_TIMEOUT_S = 60


def _build_authorized_http(creds):
    import certifi
    import httplib2
    import google_auth_httplib2
    http = httplib2.Http(ca_certs=certifi.where(), timeout=GOOGLE_HTTP_TIMEOUT_S)
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

    # Lock the entire resolve+refresh path. Without this, two threads can
    # both observe an expired cached cred and call creds.refresh() in
    # parallel, mutating the same Credentials object's token/expiry fields
    # concurrently.
    with _creds_lock:
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
    global _cached_creds
    with _creds_lock:
        _cached_creds = None
    # Cascade: every thread's cached sheets svc holds a reference to the
    # previous creds object, so they must be invalidated too or workers
    # will keep using the rotated-out token until the worker thread exits.
    try:
        from app.integrations.sheets_export import invalidate_sheets_svc_cache
        invalidate_sheets_svc_cache()
    except Exception:
        # Defensive: never let cache cleanup break the admin token-rotation
        # endpoint. The next sheet export's first call will rebuild anyway.
        pass
    # Same cascade for the per-thread Drive service, which also holds a
    # reference to the previous creds.
    try:
        from app.integrations.drive_upload import invalidate_drive_svc_cache
        invalidate_drive_svc_cache()
    except Exception:
        pass


def get_calendar_service(db=None):
    # Build fresh per call. Sharing a googleapiclient service across threads
    # routes concurrent requests through one pooled httplib2 TLS socket,
    # which is not thread-safe in OpenSSL.
    from googleapiclient.discovery import build
    creds = _get_creds(db)
    authorized_http = _build_authorized_http(creds)
    return build("calendar", "v3", http=authorized_http, cache_discovery=False)


def get_sheets_service(db=None):
    from googleapiclient.discovery import build
    creds = _get_creds(db)
    authorized_http = _build_authorized_http(creds)
    return build("sheets", "v4", http=authorized_http, cache_discovery=False)


def get_cal_status(db=None) -> dict:
    try:
        creds = _get_creds(db)
        expiry = creds.expiry.isoformat() if creds.expiry else None
        # Surface the token's effective scopes so admin can tell at a glance
        # whether a scope-sensitive feature (Crew Resources write, future
        # event creators) will actually work. Without this we had to walk
        # through Render logs to confirm a missing scope.
        scopes = list(getattr(creds, "scopes", None) or [])
        has_calendar_write = any(
            s.endswith("/auth/calendar") or s.endswith("/auth/calendar.events")
            for s in scopes
        )
        has_calendar_read = has_calendar_write or any(
            s.endswith("/auth/calendar.readonly") for s in scopes
        )
        return {
            "ok": True,
            "valid": creds.valid,
            "expired": creds.expired,
            "expiry": expiry,
            "has_refresh_token": bool(creds.refresh_token),
            "scopes": scopes,
            "has_calendar_read": has_calendar_read,
            "has_calendar_write": has_calendar_write,
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
    ignored = _ignored_invitee_emails()
    out: List[Dict[str, Any]] = []
    for it in items:
        start = it.get("start", {}).get("dateTime") or it.get("start", {}).get("date")
        end = it.get("end", {}).get("dateTime") or it.get("end", {}).get("date")
        out.append({
            "id": it.get("id"),
            "summary": it.get("summary") or "(no title)",
            "start": start,
            # `end` powers the scheduled-duration fallback for est-vs-actual
            # hours (Phase 4). Previously fetched from Google but dropped.
            "end": end,
            # Event body + location so the crew can see the job's context (the
            # office writes addresses, crew, special instructions into the
            # calendar event). Surfaced in the hub's active-job card. Google
            # returns description as light HTML sometimes; the client strips it.
            "description": it.get("description") or "",
            "location": it.get("location") or "",
            # Count of invited crew (non-declined, real people, minus workspace/
            # shared mailboxes). Cached at resolve time so the schedule fallback
            # can express estimated MAN-hours (invitees x duration).
            "invitees": _count_invitees(it.get("attendees"), ignored),
        })
    return out


def list_event_invitee_emails(event_id: str, calendar_id: str, db=None) -> List[str]:
    """The real crew invited to one event: attendee emails, non-declined, minus
    room/resource entries and ignored (shared-mailbox) addresses. Same exclusion
    rules as _count_invitees, but the addresses rather than just the count -
    used by the job-setup capture screen to pre-fill the crew (ADR 0034)."""
    from googleapiclient.discovery import build
    creds = _get_creds(db)

    def _fetch():
        authorized_http = _build_authorized_http(creds)
        svc = build("calendar", "v3", http=authorized_http, cache_discovery=False)
        return svc.events().get(calendarId=calendar_id, eventId=event_id).execute()

    it = _ssl_retry(_fetch)
    ignored = _ignored_invitee_emails()
    out: List[str] = []
    seen: set = set()
    for a in (it.get("attendees") or []):
        if not isinstance(a, dict):
            continue
        email = (a.get("email") or "").strip().lower()
        if not email or email in ignored or email in seen:
            continue
        if a.get("resource") is True or a.get("responseStatus") == "declined":
            continue
        seen.add(email)
        out.append(email)
    return out


def _ignored_invitee_emails() -> set:
    """Workspace / shared-mailbox addresses that shouldn't count as crew.
    Configured via IGNORED_INVITEE_EMALS (comma-separated); mirrors the crew-
    resources scanner's filtering without importing it (avoids an import cycle)."""
    raw = os.getenv("IGNORED_INVITEE_EMAILS", "") or ""
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _count_invitees(attendees: Any, ignored: set) -> int:
    """Number of real crew invited to an event: attendees with an email who
    haven't declined, excluding room/resource entries and ignored addresses."""
    if not isinstance(attendees, list):
        return 0
    n = 0
    for a in attendees:
        if not isinstance(a, dict):
            continue
        email = (a.get("email") or "").strip().lower()
        if not email or email in ignored:
            continue
        if a.get("resource") is True:
            continue
        if a.get("responseStatus") == "declined":
            continue
        n += 1
    return n
