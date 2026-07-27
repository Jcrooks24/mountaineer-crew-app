import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable, List, Dict, Any, Optional, Set

from sqlalchemy.orm import Session
from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.google_cal_oauth import (
    _build_authorized_http,
    _get_creds,
    _SSL_ERRORS,
)

# Bounded pool - at most 2 export threads run concurrently. Additional tasks
# queue internally and drain as workers free up. Prevents a sync burst from
# spawning unlimited threads and blowing Render's 512 MB memory limit.
_EXPORT_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sheets-export")

# Per-thread sheets svc. Each `build("sheets",…)` call pulls a ~1 MB
# discovery doc and allocates a fresh Resource tree; doing that on every
# export call was a major OOM contributor on the 512 MB Render worker.
#
# A *single* process-wide cached svc is unsafe though: the Resource wraps one
# httplib2.Http with a pooled TLS socket, and httplib2 is not thread-safe.
# Multiple threads writing to the same SSL connection caused intermittent
# `[SSL: DECRYPTION_FAILED_OR_BAD_RECORD_MAC]` errors and OpenSSL heap
# corruption that crashed the worker (`malloc(): unsorted double linked list
# corrupted`).
#
# Thread-local caching gives both: at most `pool_workers + 1` svcs in memory
# (currently 3) instead of N-per-call, and each thread owns its own httplib2
# socket - no cross-thread SSL races.
#
# AuthorizedHttp refreshes the underlying creds in place on 401, so a cached
# svc stays valid across token expiry without rebuilding. Admin-driven token
# rotation calls `invalidate_sheets_svc_cache()` which bumps a version; each
# thread lazily rebuilds on its next call when its cached version is stale.
_sheets_svc_threadlocal = threading.local()
_sheets_svc_version: int = 0
_sheets_svc_version_lock = threading.Lock()


def _get_sheets_svc(db: Session) -> Any:
    cached = getattr(_sheets_svc_threadlocal, "svc", None)
    cached_version = getattr(_sheets_svc_threadlocal, "version", -1)
    if cached is not None and cached_version == _sheets_svc_version:
        return cached

    from googleapiclient.discovery import build as _build
    creds = _get_creds(db)
    authorized_http = _build_authorized_http(creds)
    svc = _build("sheets", "v4", http=authorized_http, cache_discovery=False)
    _sheets_svc_threadlocal.svc = svc
    _sheets_svc_threadlocal.version = _sheets_svc_version
    return svc


def invalidate_sheets_svc_cache() -> None:
    """Force every thread to rebuild its cached sheets svc on next use.
    Called from `google_cal_oauth.invalidate_cache()` when admin rotates the
    OAuth token. Bumping a version counter is safe across threads; we can't
    reach into another thread's threading.local from here."""
    global _sheets_svc_version
    with _sheets_svc_version_lock:
        _sheets_svc_version += 1

# Coalesce estimate exports per estimate_uuid. Autosave fires a PATCH per
# keystroke; without coalescing, the pool's internal queue grew unbounded and
# OOMed (each queued task held a captured payload, and each running export
# built a fresh googleapiclient with a ~1MB discovery doc).
_estimate_export_in_flight: Set[str] = set()
_estimate_export_rerun: Set[str] = set()
_estimate_export_lock = threading.Lock()

# Same coalescing for job-inventory exports (crew adds stream in as the
# offline queue drains). Keyed by job_uuid.
_job_inventory_export_in_flight: Set[str] = set()
_job_inventory_export_rerun: Set[str] = set()
_job_inventory_export_lock = threading.Lock()

_incident_export_in_flight: Set[str] = set()
_incident_export_rerun: Set[str] = set()
_incident_export_lock = threading.Lock()

_availability_export_in_flight: Set[str] = set()
_availability_export_rerun: Set[str] = set()
_availability_export_lock = threading.Lock()

_bol_export_in_flight: Set[str] = set()
_bol_export_rerun: Set[str] = set()
_bol_export_lock = threading.Lock()

# Serialize note-cell updates per event_id so rapid edits on the same event
# (or client retries) can't stack multiple in-memory googleapiclient instances
# in the pool queue. Bounded so the dict can't grow forever as new event_ids
# arrive - without a cap this is a slow leak that eventually OOMs the worker.
_event_note_locks: Dict[str, threading.Lock] = {}
_event_note_locks_guard = threading.Lock()

# Mirror dict for editable-timestamp cell updates. Kept separate from the
# note locks so a timestamp edit and a note edit on the same event don't
# block each other - they target different cells in the same sheet row.
_event_timestamp_locks: Dict[str, threading.Lock] = {}
_event_timestamp_locks_guard = threading.Lock()

# Cap chosen so the two dicts together stay well under 1 MB even at full
# capacity. Pruning is FIFO via insertion-ordered dict iteration.
_MAX_EVENT_LOCKS = 4096


def _bounded_lock(
    locks: Dict[str, threading.Lock], event_id: str
) -> threading.Lock:
    lock = locks.get(event_id)
    if lock is None:
        # Prune the oldest unheld lock(s) until we're back under the cap.
        # We only evict locks we can acquire non-blocking, so a lock in
        # active use is never yanked out from under its holder.
        while len(locks) >= _MAX_EVENT_LOCKS:
            evicted = False
            for k in list(locks.keys()):
                candidate = locks[k]
                if candidate.acquire(blocking=False):
                    candidate.release()
                    del locks[k]
                    evicted = True
                    break
            if not evicted:
                # Every lock is currently held - bail out and let the dict
                # exceed the cap temporarily rather than block forever.
                break
        lock = threading.Lock()
        locks[event_id] = lock
    return lock


def _lock_for_event_note(event_id: str) -> threading.Lock:
    with _event_note_locks_guard:
        return _bounded_lock(_event_note_locks, event_id)


def _lock_for_event_timestamp(event_id: str) -> threading.Lock:
    with _event_timestamp_locks_guard:
        return _bounded_lock(_event_timestamp_locks, event_id)


def run_export_in_background(export_fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
    """Submit a sheets export to the bounded background pool with a fresh
    DB session, so a slow or failing Google call never blocks the API
    response (Render kills requests past its proxy timeout, which surfaces
    on the client as "Failed to fetch").

    `export_fn` must accept a Session as its first positional argument,
    followed by whatever caller args were passed. The fresh session is
    created inside the worker.
    """
    def _worker() -> None:
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            export_fn(db, *args, **kwargs)
            record_sheet_sync(db, export_fn.__name__, True)
        except Exception as exc:
            print(f"[sheets] background export failed ({export_fn.__name__}): {exc}")
            try:
                db.rollback()
            except Exception:
                pass
            record_sheet_sync(db, export_fn.__name__, False, str(exc))
        finally:
            try:
                db.close()
            except Exception:
                pass

    _EXPORT_POOL.submit(_worker)


def record_sheet_sync(db: Session, fn_name: str, ok: bool, error: Optional[str] = None) -> None:
    """Best-effort: record the last success/failure for a sheet export function so
    the Advanced Settings health check can flag a silently-failing sync. Never
    raises - a health-tracking hiccup must not affect the export itself."""
    try:
        from app.db.models.sheet_sync_status import SheetSyncStatus
        now = datetime.utcnow()
        row = db.query(SheetSyncStatus).filter(SheetSyncStatus.fn_name == fn_name).first()
        if row is None:
            row = SheetSyncStatus(fn_name=fn_name)
            db.add(row)
        if ok:
            row.last_ok_at = now
        else:
            row.last_error_at = now
            row.last_error = (error or "")[:500]
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

DEFAULT_SHEET_ID = "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs"
DEFAULT_MATERIALS_TAB = "Materials"

EVENTS_HEADERS = [
    "event_id", "timestamp", "logged_at", "job_uuid", "job_name", "job_date",
    "type", "note", "lat", "lng", "accuracy_m", "device_id", "created_by", "synced",
    "entered_by", "entered_on",
]
MATERIALS_HEADERS = [
    "submission_id", "created_at", "job_uuid", "job_name", "job_date", "job_label",
    "notes", "item_name", "qty", "unit_price", "line_total", "submission_total",
    "entered_by", "entered_on",
]


def _entry_status_for(db: Session, job_uuid: str) -> tuple[str, str]:
    """Look up the admin's data-entry checkpoint for a job. Returns
    (entered_by, entered_on) or ("", "") if no checkpoint has been recorded
    yet. Imports inline so this module stays import-cycle-safe even though
    AdminEntryStatus is a sibling SQLAlchemy model.
    """
    if not job_uuid:
        return ("", "")
    try:
        from app.db.models.admin_entry_status import AdminEntryStatus
    except ImportError:
        return ("", "")
    row = (
        db.query(AdminEntryStatus)
        .filter(AdminEntryStatus.job_uuid == job_uuid)
        .first()
    )
    if not row:
        return ("", "")
    return (row.entered_by or "", row.entered_on or "")


def _col_letter(n: int) -> str:
    """Convert a 0-based column index to A1-notation letter(s). e.g. 0→A, 25→Z, 26→AA."""
    result = ""
    n += 1  # switch to 1-based
    while n > 0:
        n, r = divmod(n - 1, 26)
        result = chr(65 + r) + result
    return result


# ── Transient-failure retry ──────────────────────────────────────────────────
# The shared `_ssl_retry` covers dropped TLS connections only. The other way a write
# dies for no lasting reason is Google's per-minute quota: Sheets allows 60 read
# and 60 write requests per minute per user, and a burst of syncs answers with
# `HttpError 429 ... RATE_LIMIT_EXCEEDED`. That used to strand the row - the
# export raised, the record kept no retry state, and the data only reached the
# sheet if someone happened to edit and re-save it. 5xx (backendError) is the
# same story.
#
# Retry is applied per API request, never per export: a request that returned
# 429/5xx did not apply, so re-issuing it is idempotent by construction. Wrapping
# a whole multi-step export would not be - the append-style writes would double.
_TRANSIENT_STATUSES = {429, 500, 502, 503, 504}

# A dropped TLS connection can be re-tried immediately; quota is a per-minute
# bucket, so that backoff has to be long enough to actually clear it. Keeping the
# two schedules separate matters because these run on a 2-worker pool - waiting
# 26s on an SSL blip would stall exports that had nothing wrong with them.
_SSL_BACKOFF_SECONDS = (0.5, 1.0, 2.0)
_QUOTA_BACKOFF_SECONDS = (5.0, 15.0, 30.0)


def _google_error_kind(exc: Exception) -> Optional[str]:
    """Classify an exception as "quota" (429/5xx - wait it out), "ssl" (dropped
    connection - retry promptly), or None (permanent, do not retry)."""
    status = getattr(getattr(exc, "resp", None), "status", None)
    if status is None:
        status = getattr(exc, "status_code", None)
    try:
        if status is not None and int(status) in _TRANSIENT_STATUSES:
            return "quota"
    except (TypeError, ValueError):
        pass
    msg = str(exc)
    if "RATE_LIMIT_EXCEEDED" in msg or "Quota exceeded" in msg:
        return "quota"
    if any(marker in msg for marker in _SSL_ERRORS):
        return "ssl"
    return None


def _api(fn, max_attempts: int = 4):
    """Execute a single Google API request, retrying transient failures with
    backoff. Use for every Sheets call; `fn` must issue exactly one request."""
    last_err: Optional[Exception] = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - re-raised unless transient
            kind = _google_error_kind(exc)
            if kind is None or attempt >= max_attempts - 1:
                raise
            last_err = exc
            schedule = _QUOTA_BACKOFF_SECONDS if kind == "quota" else _SSL_BACKOFF_SECONDS
            delay = schedule[min(attempt, len(schedule) - 1)]
            print(f"[sheets] transient {kind} error, retry in {delay}s: {exc}")
            time.sleep(delay)
    raise last_err  # type: ignore[misc]


# ── Spreadsheet metadata cache ───────────────────────────────────────────────
# Every export used to issue at least two full `spreadsheets().get()` calls - one
# in `_ensure_tab`, one in `_write_rows_top` - purely to learn tab names and
# numeric sheet ids. On a sheet with ~20 tabs that is the single biggest consumer
# of the 60-reads/min quota, and it is what puts bursts over the line into 429.
# The tab layout only changes when we create a tab (or an admin renames one in
# the sheet), so a short TTL is safe: stale-metadata failures self-heal because
# every consumer refreshes and retries once before giving up.
_META_TTL_SECONDS = 30.0
_meta_cache: Dict[str, tuple] = {}  # spreadsheet_id -> (expires_at, {title: sheetId})
_meta_cache_lock = threading.Lock()


def _sheet_ids(svc: Any, spreadsheet_id: str, refresh: bool = False) -> Dict[str, int]:
    """Return {tab title: numeric sheetId} for the spreadsheet, cached briefly.
    Pass `refresh=True` to force a live read (used by the health check and by
    the retry path when a cached id turns out to be stale)."""
    now = time.monotonic()
    if not refresh:
        with _meta_cache_lock:
            entry = _meta_cache.get(spreadsheet_id)
        if entry and entry[0] > now:
            return entry[1]

    meta = _api(lambda: svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute())
    ids = {
        s["properties"]["title"]: s["properties"]["sheetId"]
        for s in meta.get("sheets", [])
        if "properties" in s
    }
    with _meta_cache_lock:
        _meta_cache[spreadsheet_id] = (time.monotonic() + _META_TTL_SECONDS, ids)
    return ids


def _invalidate_meta_cache(spreadsheet_id: Optional[str] = None) -> None:
    """Drop cached tab metadata - called right after we create a tab so the new
    tab is visible immediately rather than after the TTL."""
    with _meta_cache_lock:
        if spreadsheet_id is None:
            _meta_cache.clear()
        else:
            _meta_cache.pop(spreadsheet_id, None)


def _ensure_tab(svc: Any, spreadsheet_id: str, tab: str, headers: List[str]) -> List[str]:
    """
    Ensure the sheet tab exists and contains all expected header columns.

    - If the tab does not exist: create it and write the full header row.
    - If the tab exists: read the current header row; append any columns that
      are missing (new fields added over time) to the right of the existing ones.

    Returns the final ordered list of headers as they appear in the sheet
    (existing columns first, any newly-added columns at the end).
    """
    existing_tabs = _sheet_ids(svc, spreadsheet_id)

    if tab not in existing_tabs:
        # Cached metadata can be up to _META_TTL_SECONDS stale; confirm against a
        # live read before creating, so we never try to add a tab that exists
        # (Sheets answers that with a hard 400, which is not retryable).
        existing_tabs = _sheet_ids(svc, spreadsheet_id, refresh=True)

    if tab not in existing_tabs:
        # Create the tab
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute())
        _invalidate_meta_cache(spreadsheet_id)
        # Write full header row
        _api(lambda: svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            body={"values": [headers]},
        ).execute())
        return list(headers)

    # Tab exists - read current header row
    result = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!1:1",
    ).execute())
    current = result.get("values", [[]])[0] if result.get("values") else []

    # Find any columns we want but that aren't in the sheet yet
    missing = [h for h in headers if h not in current]
    if missing:
        start_letter = _col_letter(len(current))
        _api(lambda: svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{start_letter}1",
            valueInputOption="RAW",
            body={"values": [missing]},
        ).execute())
        current = current + missing

    return current


def _build_row(data: Dict[str, Any], headers: List[str]) -> List[Any]:
    """Map a data dict to a positional list using the sheet's actual column order."""
    return [data.get(h, "") for h in headers]


def _write_rows_top(
    svc: Any,
    spreadsheet_id: str,
    tab: str,
    rows: List[List[Any]],
) -> None:
    """Insert `rows` immediately below the header row so the tab reads
    newest-first. Two API calls (insertDimension + values.update) instead
    of one for `.values().append()`, which is the cost of putting most
    recent activity at the top - what admins actually want when they open
    the sheet looking for what just happened.

    Late arrivals from the reconciler land at the top regardless of their
    actual chronology; the Apps Script cleanup re-sorts strictly when
    order drifts.

    No-op for empty `rows`. Falls back to plain append if the tab can't
    be found in metadata (defensive - _ensure_tab should have created it).
    """
    if not rows:
        return

    sheet_numeric_id = _sheet_ids(svc, spreadsheet_id).get(tab)
    if sheet_numeric_id is None:
        # Not in cached metadata - confirm with a live read before falling back
        # to a plain append (which would put the row at the bottom).
        sheet_numeric_id = _sheet_ids(svc, spreadsheet_id, refresh=True).get(tab)
    if sheet_numeric_id is None:
        _api(lambda: svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute())
        return

    n = len(rows)

    def _insert(sid: int) -> None:
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{
                "insertDimension": {
                    "range": {
                        "sheetId": sid,
                        "dimension": "ROWS",
                        "startIndex": 1,        # row 2 (0-based) - directly below header
                        "endIndex": 1 + n,
                    },
                    # Don't pull header formatting (bold, frozen, etc.) onto the
                    # data rows we're about to write.
                    "inheritFromBefore": False,
                }
            }]},
        ).execute())

    try:
        _insert(sheet_numeric_id)
    except Exception:
        # A cached sheetId that no longer resolves (tab deleted/recreated in the
        # sheet) fails with a hard 400 that retrying can't fix. Refresh once and
        # try again before surfacing the failure.
        fresh = _sheet_ids(svc, spreadsheet_id, refresh=True).get(tab)
        if fresh is None or fresh == sheet_numeric_id:
            raise
        _insert(fresh)

    width = max((len(r) for r in rows), default=0)
    if width <= 0:
        return
    end_col = _col_letter(width - 1)
    _api(lambda: svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A2:{end_col}{1 + n}",
        valueInputOption="RAW",
        body={"values": rows},
    ).execute())


def export_events_to_sheets(db: Session, events: List[Dict[str, Any]]) -> int:
    """
    Append inserted events to Google Sheets (Events tab), with dedupe.
    Returns number of rows appended.
    Never raises; caller should wrap in try/except anyway.
    """
    if not events:
        return 0

    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    tab = os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events"

    # 1) Filter out already-exported event_ids (single IN query instead of N queries)
    all_ids = [str(ev["event_id"]) for ev in events]
    rows = db.execute(
        text("SELECT event_id FROM sheet_event_exports WHERE event_id IN :ids")
        .bindparams(bindparam("ids", expanding=True)),
        {"ids": all_ids},
    ).fetchall()
    already_exported = {r[0] for r in rows}
    new_events = [ev for ev in events if str(ev["event_id"]) not in already_exported]

    if not new_events:
        return 0

    # 2) Get Sheets service and ensure tab + headers exist
    svc = _get_sheets_svc(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, EVENTS_HEADERS)

    # 3) Build rows keyed by column name so order always matches the sheet
    # Cache entry-status lookups so a batch with many events for the same
    # job hits the DB once per job, not once per event.
    entry_cache: Dict[str, tuple[str, str]] = {}

    rows: List[List[Any]] = []
    for ev in new_events:
        # `logged_at` falls back to `timestamp` for older callers that
        # haven't been updated to pass it explicitly. New rows from
        # /api/sync and the reconciler always pass it.
        logged_at = ev.get("logged_at") or ev.get("timestamp", "")
        ju = ev.get("job_uuid", "") or ""
        if ju not in entry_cache:
            entry_cache[ju] = _entry_status_for(db, ju)
        entered_by, entered_on = entry_cache[ju]
        row_data: Dict[str, Any] = {
            "event_id":   ev["event_id"],
            "timestamp":  ev["timestamp"],
            "logged_at":  logged_at,
            "job_uuid":   ev["job_uuid"],
            "job_name":   ev.get("job_name") or "",
            "job_date":   ev.get("job_date") or "",
            "type":       ev["type"],
            "note":       ev.get("note") or "",
            "lat":        ev.get("lat") if ev.get("lat") is not None else "",
            "lng":        ev.get("lng") if ev.get("lng") is not None else "",
            "accuracy_m": ev.get("accuracy_m") if ev.get("accuracy_m") is not None else "",
            "device_id":  ev.get("device_id") or "",
            "created_by": ev.get("created_by") or "",
            "synced":     "synced",
            "entered_by": entered_by,
            "entered_on": entered_on,
        }
        rows.append(_build_row(row_data, actual_headers))

    # 4) Insert at top - newest activity above older rows
    _write_rows_top(svc, spreadsheet_id, tab, rows)

    # 5) Mark exported (dedupe)
    for ev in new_events:
        db.execute(
            text(
                "INSERT INTO sheet_event_exports(event_id) VALUES (:event_id) "
                "ON CONFLICT (event_id) DO NOTHING"
            ),
            {"event_id": str(ev["event_id"])},
        )
    db.commit()

    return len(rows)


def export_materials_to_sheets(db: Session, submission: dict) -> int:
    """
    Append material line items from a submission to the Materials tab in Google Sheets.
    One row per line item. Deduplicates by submission_id + item_id.
    Returns number of rows appended.
    """
    items = submission.get("items", [])
    if not items:
        return 0

    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    tab = os.getenv("SHEETS_MATERIALS_TAB", DEFAULT_MATERIALS_TAB).strip() or DEFAULT_MATERIALS_TAB

    submission_id = str(submission["id"])
    job_uuid  = submission.get("job_uuid", "")
    job_name  = submission.get("jobName", "")
    job_label = submission.get("jobLabel", "")
    job_date  = submission.get("jobDate", "")
    created_at = submission.get("created_at", "")
    notes = submission.get("notes", "")
    total = submission.get("total", 0)
    entered_by, entered_on = _entry_status_for(db, job_uuid)

    # 1) Build rows, skipping already-exported items
    new_rows: List[Dict[str, Any]] = []
    for item in items:
        item_id = str(item.get("id", ""))
        export_key = f"{submission_id}:{item_id}"

        exists = db.execute(
            text("SELECT 1 FROM sheet_material_exports WHERE export_key = :key LIMIT 1"),
            {"key": export_key},
        ).fetchone()
        if exists:
            continue

        qty = item.get("qty", 1)
        unit_price = item.get("unitPrice")
        line_total = round(qty * unit_price, 2) if unit_price is not None else ""

        new_rows.append({
            "submission_id":    submission_id,
            "created_at":       created_at,
            "job_uuid":         job_uuid,
            "job_name":         job_name,
            "job_date":         job_date,
            "job_label":        job_label,
            "notes":            notes,
            "item_name":        item.get("name", ""),
            "qty":              qty,
            "unit_price":       unit_price if unit_price is not None else "",
            "entered_by":       entered_by,
            "entered_on":       entered_on,
            "line_total":       line_total,
            "submission_total": total,
        })

    if not new_rows:
        return 0

    # 2) Use the shared cached sheets svc (built once at module level with
    #    certifi CA bundle) for both _ensure_tab and append.
    svc = _get_sheets_svc(db)

    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, MATERIALS_HEADERS)
    rows = [_build_row(r, actual_headers) for r in new_rows]

    _write_rows_top(svc, spreadsheet_id, tab, rows)

    # 3) Mark exported for deduplication
    for item in items:
        item_id = str(item.get("id", ""))
        export_key = f"{submission_id}:{item_id}"
        db.execute(
            text(
                "INSERT INTO sheet_material_exports(export_key) VALUES (:key) "
                "ON CONFLICT (export_key) DO NOTHING"
            ),
            {"key": export_key},
        )
    db.commit()

    return len(new_rows)


def update_event_note_in_sheets(db: Session, event_id: str, note: Optional[str]) -> int:
    """Rewrite the `note` cell for an already-exported event row. Returns the
    number of rows updated (0 or 1).

    No-op when the event hasn't been exported to the sheet yet; the note will
    flow out of `export_events_to_sheets` on first export.

    Serialized per event_id so concurrent retries for the same event don't
    pile up redundant Sheet API round-trips for the same row. The non-blocking
    lock acquire skips the update entirely when another worker is already
    handling this event - the queued retry will catch the latest value.
    """
    if not event_id:
        return 0

    lock = _lock_for_event_note(event_id)
    if not lock.acquire(blocking=False):
        # Another worker is already syncing this event_id - skip. The client's
        # patch queue will re-issue the latest value if this call failed to
        # land.
        return 0

    try:
        spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
        tab = os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events"

        svc = _get_sheets_svc(db)
        hdr = _api(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute())
        headers_row = (hdr.get("values") or [[]])[0]
        if "event_id" not in headers_row or "note" not in headers_row:
            return 0

        event_col_letter = _col_letter(headers_row.index("event_id"))
        note_col_letter = _col_letter(headers_row.index("note"))

        col = _api(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{event_col_letter}:{event_col_letter}",
        ).execute())
        col_values = col.get("values") or []

        target_row: Optional[int] = None
        for i, row in enumerate(col_values):
            if i == 0:
                continue  # header
            value = row[0] if row else ""
            if value == event_id:
                target_row = i + 1  # sheet rows are 1-based
                break

        # Drop the large column response before the network update so the
        # bytes are eligible for GC while we wait on Google.
        del col, col_values

        if target_row is None:
            return 0

        _api(lambda: svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{note_col_letter}{target_row}",
            valueInputOption="RAW",
            body={"values": [[note or ""]]},
        ).execute())
        return 1
    finally:
        lock.release()


def delete_event_from_sheets(db: Session, event_id: str) -> int:
    """Remove the Events-tab row for a deleted event. Returns rows deleted (0/1).
    No-op when the event was never exported."""
    if not event_id:
        return 0
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    tab = os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events"
    svc = _get_sheets_svc(db)
    sheet_numeric_id = _sheet_numeric_id(svc, spreadsheet_id, tab)
    if sheet_numeric_id is None:
        return 0
    hdr = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!1:1",
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0]
    if "event_id" not in headers_row:
        return 0
    col_letter = _col_letter(headers_row.index("event_id"))
    col = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!{col_letter}:{col_letter}",
    ).execute())
    col_values = col.get("values") or []
    target_indices = [i for i, row in enumerate(col_values) if i > 0 and (row[0] if row else "") == event_id]
    if not target_indices:
        return 0
    requests = [
        {"deleteDimension": {"range": {
            "sheetId": sheet_numeric_id, "dimension": "ROWS", "startIndex": idx, "endIndex": idx + 1,
        }}}
        for idx in sorted(target_indices, reverse=True)
    ]
    _api(lambda: svc.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests},
    ).execute())
    return len(target_indices)


def update_event_timestamp_in_sheets(db: Session, event_id: str, timestamp: str) -> int:
    """Rewrite the editable `timestamp` cell for an already-exported event row.
    Returns the number of rows updated (0 or 1).

    No-op when the event hasn't been exported to the sheet yet; the new value
    will flow out of `export_events_to_sheets` on first export. Mirrors the
    note updater: serialized per event_id, non-blocking lock acquire so a
    concurrent retry skips rather than re-running redundant work.
    """
    if not event_id:
        return 0

    lock = _lock_for_event_timestamp(event_id)
    if not lock.acquire(blocking=False):
        return 0

    try:
        spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
        tab = os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events"

        svc = _get_sheets_svc(db)
        hdr = _api(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute())
        headers_row = (hdr.get("values") or [[]])[0]
        if "event_id" not in headers_row or "timestamp" not in headers_row:
            return 0

        event_col_letter = _col_letter(headers_row.index("event_id"))
        ts_col_letter = _col_letter(headers_row.index("timestamp"))

        col = _api(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{event_col_letter}:{event_col_letter}",
        ).execute())
        col_values = col.get("values") or []

        target_row: Optional[int] = None
        for i, row in enumerate(col_values):
            if i == 0:
                continue
            value = row[0] if row else ""
            if value == event_id:
                target_row = i + 1
                break

        del col, col_values

        if target_row is None:
            return 0

        _api(lambda: svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{ts_col_letter}{target_row}",
            valueInputOption="RAW",
            body={"values": [[timestamp]]},
        ).execute())
        return 1
    finally:
        lock.release()


def delete_materials_from_sheets(db: Session, submission_id: str) -> int:
    """Remove every row in the Materials tab belonging to `submission_id` and
    clear the corresponding dedupe entries so a later re-submission syncs
    cleanly. Returns the number of sheet rows deleted.

    Sheet writes were previously append-only, which left ghost rows after a
    crew member removed a material from a job - admins reading the sheet for
    cost analysis would see items that no longer exist in the app.
    """
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    tab = os.getenv("SHEETS_MATERIALS_TAB", DEFAULT_MATERIALS_TAB).strip() or DEFAULT_MATERIALS_TAB

    svc = _get_sheets_svc(db)

    # Resolve the numeric sheetId for deleteDimension
    sheet_numeric_id = _sheet_numeric_id(svc, spreadsheet_id, tab)
    if sheet_numeric_id is None:
        return 0

    # Locate the submission_id column
    hdr = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!1:1",
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0]
    if "submission_id" not in headers_row:
        return 0
    col_letter = _col_letter(headers_row.index("submission_id"))

    # Pull just that column to find matching row indices
    col = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!{col_letter}:{col_letter}",
    ).execute())
    col_values = col.get("values") or []

    target_indices: List[int] = []  # 0-based row indices suitable for deleteDimension
    for i, row in enumerate(col_values):
        if i == 0:
            continue  # header row
        value = row[0] if row else ""
        if value == submission_id:
            target_indices.append(i)

    if target_indices:
        # Delete bottom-up so earlier deletes don't shift later indices.
        requests = [
            {"deleteDimension": {"range": {
                "sheetId": sheet_numeric_id,
                "dimension": "ROWS",
                "startIndex": idx,
                "endIndex": idx + 1,
            }}}
            for idx in sorted(target_indices, reverse=True)
        ]
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": requests},
        ).execute())

    # Always clear dedupe entries so a re-add with the same ids would re-export.
    db.execute(
        text("DELETE FROM sheet_material_exports WHERE export_key LIKE :prefix"),
        {"prefix": f"{submission_id}:%"},
    )
    db.commit()

    return len(target_indices)


# ─────────────────────────────────────────────────────────────────────────────
# Generic helpers for newer forms (job reports, bills, DVIRs, prior-hours,
# RODS, estimates). Each kind has its own SHEETS_<KIND>_TAB env var so staging
# can point at a dedicated worksheet like "JobReportsStaging".
# ─────────────────────────────────────────────────────────────────────────────

def _generic_already_exported(db: Session, kind: str, export_key: str) -> bool:
    row = db.execute(
        text(
            "SELECT 1 FROM sheet_generic_exports WHERE kind = :kind AND export_key = :key LIMIT 1"
        ),
        {"kind": kind, "key": export_key},
    ).fetchone()
    return row is not None


def _generic_mark_exported(db: Session, kind: str, export_keys: List[str]) -> None:
    for k in export_keys:
        db.execute(
            text(
                "INSERT INTO sheet_generic_exports(kind, export_key) VALUES (:kind, :key) "
                "ON CONFLICT (kind, export_key) DO NOTHING"
            ),
            {"kind": kind, "key": k},
        )
    db.commit()


def _append_rows(
    db: Session,
    tab: str,
    headers: List[str],
    rows_data: List[Dict[str, Any]],
) -> int:
    """Append one or more row dicts to `tab`, creating the tab + headers if needed."""
    if not rows_data:
        return 0
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    svc = _get_sheets_svc(db)

    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, headers)
    rows = [_build_row(r, actual_headers) for r in rows_data]

    _write_rows_top(svc, spreadsheet_id, tab, rows)
    return len(rows)


def _iso(dt: Any) -> str:
    """Serialize a datetime for a sheet cell. Naive datetimes in this app
    are stored as UTC; emit them with a trailing 'Z' so any tool reading
    the sheet (Excel, scripts, BigQuery) parses them as UTC instead of
    silently treating them as the reader's local timezone."""
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        s = dt.isoformat()
        if dt.tzinfo is None:
            s += "Z"
        return s
    return str(dt)


# ── Job Reports ──────────────────────────────────────────────────────────────

_REVIEW_CANDIDATE_LABELS = {"yes": "Yes", "no": "No", "na": "N/A"}


def _review_candidate_label(value: Any) -> str:
    """Map the stored review_candidate string to the human-readable sheet
    cell. Falls back to the raw value if the column ever contains something
    unexpected (e.g. a row written before the boolean→string migration on
    a misconfigured environment) so the data isn't silently dropped."""
    if isinstance(value, str):
        return _REVIEW_CANDIDATE_LABELS.get(value, value)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return ""


JOB_REPORT_HEADERS = [
    "job_uuid", "job_name", "submitted_by", "personal_vehicles",
    "bill_personal_vehicles",
    "dumpster_pct", "recycling_pct", "billing_method",
    "review_candidate", "hours_match", "hours_verified", "hours_mismatch_reason",
    "has_crew_feedback", "crew_feedback",
    "employee_hours", "has_non_billable_hours", "per_diem_total",
    "job_type_tags", "truck_fullness",
    "furniture_count", "box_count",
    "actual_man_hours",
    "overage_note",
    "created_at", "updated_at",
    "entered_by", "entered_on",
]


def _billable_man_hours(entries: Optional[list]) -> float:
    """Total billable man-hours for a report: sum of actual worked hours across
    non-`non_billable` entries, rounded once (company quarter-hour rule). Mirrors
    the 'Total man-hours' line in _format_employee_hours."""
    if not entries:
        return 0.0
    total = 0.0
    for e in entries:
        if not isinstance(e, dict) or e.get("non_billable"):
            continue
        try:
            total += float(e.get("hours") or 0)
        except (TypeError, ValueError):
            continue
    return _round_billable_quarter(total)


def _yes_no_blank(value: Any) -> str:
    """Tri-state Yes/No/blank for nullable boolean sheet columns: True → "Yes",
    False → "No", None → "" (so unanswered older rows don't read as "No").
    """
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    return ""


def _has_non_billable(entries: Optional[list]) -> str:
    """Yes/No flag for whether any employee row in the report is marked
    non-billable. Surfaced as its own JobReports column so admins can
    spot non-billable time at a glance instead of scanning the multi-line
    employee_hours cell."""
    if not entries:
        return "No"
    for e in entries:
        if isinstance(e, dict) and e.get("non_billable"):
            return "Yes"
    return "No"


def _format_truck_fullness(entries: Optional[list]) -> str:
    """One line per truck used, e.g. "26Int: V75×H50 (38%)". The composite %
    is vertical×horizontal/100, matching the interior 25% fill marks. Semicolon-
    joined so it stays a single readable cell."""
    if not entries:
        return ""
    parts: list[str] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        truck = (e.get("truck") or "").strip() or "-"
        try:
            v = int(e.get("vertical_pct") or 0)
            h = int(e.get("horizontal_pct") or 0)
        except (TypeError, ValueError):
            v = h = 0
        combined = round(v * h / 100)
        # Rental trucks: note the length (if given) and that fill is a best
        # guess (no interior markers). e.g. "Penske 26ft (rental): V75×H50 (38%)".
        label = truck
        if e.get("is_rental"):
            length = e.get("length_ft")
            if length not in (None, "", 0):
                try:
                    length = int(float(length))
                except (TypeError, ValueError):
                    length = None
                if length:
                    label = f"{truck} {length}ft"
            label = f"{label} (rental)"
        parts.append(f"{label}: V{v}×H{h} ({combined}%)")
    return "; ".join(parts)


def _per_diem_total(report: Dict[str, Any]) -> Any:
    """Total per-diem owed for this report: $50 per crew member when the report's
    out_of_town flag is set (the whole crew is out of town for the day). Crew
    size comes from the named employee-hours rows; floors at 1 so a drive-only
    day with no hours rows still records the driver's per-diem."""
    if not report.get("out_of_town"):
        return 0
    entries = report.get("employee_hours") or []
    n = sum(1 for e in entries if isinstance(e, dict) and (e.get("name") or "").strip())
    return 50 * max(1, n)


def _round_billable_quarter(hours: float) -> float:
    """Company rounding: ≥5 min into the current quarter rounds UP, else DOWN.

    Examples:
      8.07 (8:04) → 8.00
      8.08 (8:05) → 8.25
      8.31 (8:19) → 8.25
      8.34 (8:20) → 8.50
    """
    if hours <= 0:
        return 0.0
    total_min = int(round(hours * 60))
    quarters = total_min // 15
    remainder = total_min - quarters * 15
    rounded_min = (quarters + 1) * 15 if remainder >= 5 else quarters * 15
    return rounded_min / 60.0


def _format_employee_hours(entries: Optional[list]) -> str:
    """Pretty-print the per-employee hours list into a single multi-line cell.

    Office assistant reads this off the JobReports worksheet to invoice; the
    plain-text format below matches the layout used in the Admin Job Summary
    invoice copy-paste block so the same string can be transcribed either way.

    Each row shows the company's quarter-hour rounded value with the actual
    worked hours in parens - both billable and non-billable, always shown
    even when no rounding was needed. The total still rounds the *summed
    actuals* once at the end so the totals line is what gets invoiced;
    non-billable rows are excluded from the total sum.
    """
    if not entries:
        return ""
    lines: list[str] = []
    total_actual = 0.0
    for e in entries:
        if not isinstance(e, dict):
            continue
        name = (e.get("name") or "").strip() or "-"
        start = (e.get("start") or "").strip()
        end = (e.get("end") or "").strip()
        try:
            br = float(e.get("break_hours") or 0)
        except (TypeError, ValueError):
            br = 0.0
        try:
            hrs = float(e.get("hours") or 0)
        except (TypeError, ValueError):
            hrs = 0.0
        non_billable = bool(e.get("non_billable") or False)
        if not non_billable:
            total_actual += hrs
        rounded = _round_billable_quarter(hrs)
        span = f"{start}–{end}" if start and end else (start or end or "")
        pieces = [name + ":"]
        if span:
            pieces.append(span + ("," if br > 0 else ""))
        if br > 0:
            pieces.append(f"break {br:.2f}h")
        # Per-skill ratings ride inside each entry (keyed by skill name);
        # display-only, never affect the man-hours math. Falls back to the
        # legacy single skill_rating for reports saved before the change.
        skill_str = "skill N/A"
        ratings = e.get("skill_ratings")
        if isinstance(ratings, dict) and ratings:
            parts = []
            for sk_name, sk_val in ratings.items():
                try:
                    n = int(sk_val)
                except (TypeError, ValueError):
                    continue
                # -1 is the explicit "not applicable" sentinel the crew set.
                parts.append(f"{sk_name} N/A" if n < 0 else f"{sk_name} {n}/5")
            if parts:
                skill_str = "skills: " + ", ".join(parts)
        else:
            raw_skill = e.get("skill_rating")
            try:
                skill = int(raw_skill) if raw_skill is not None else None
            except (TypeError, ValueError):
                skill = None
            if skill:
                skill_str = f"skill {skill}/5"
        tail = f"{rounded:.2f}h (actual {hrs:.2f}h), {skill_str}"
        if non_billable:
            pieces.append(f"→ non-billable {tail}")
        else:
            pieces.append(f"→ {tail}")
        lines.append(" ".join(pieces))
    if lines:
        total_billable = _round_billable_quarter(total_actual)
        lines.append(
            f"Total man-hours: {total_billable:.2f}h (actual {total_actual:.2f}h)"
        )
    return "\n".join(lines)


def export_job_report_to_sheets(db: Session, report: Dict[str, Any]) -> int:
    """Replace-style export: exactly one row per job_uuid in the JobReports
    tab. Any prior row for this job is deleted before the fresh row is
    appended so re-saves overwrite in place instead of stacking new rows.

    Previously used the generic_exports dedupe keyed on job_uuid+updated_at,
    which let every save through as a new row. The dedupe table entries for
    the 'job_report' kind are now inert; we don't bother cleaning them up
    since they take no part in the new flow.
    """
    tab = os.getenv("SHEETS_JOB_REPORTS_TAB", "JobReports").strip() or "JobReports"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    job_uuid = report.get("job_uuid", "") or ""
    if not job_uuid:
        return 0

    entered_by, entered_on = _entry_status_for(db, job_uuid)
    _actual_man_hours = _billable_man_hours(report.get("employee_hours"))
    row = {
        "job_uuid": job_uuid,
        "job_name": report.get("job_name", ""),
        "submitted_by": report.get("submitted_by_name", "") or "",
        "personal_vehicles": report.get("personal_vehicles", ""),
        "bill_personal_vehicles": _yes_no_blank(report.get("bill_personal_vehicles")),
        "dumpster_pct": report.get("dumpster_pct", ""),
        "recycling_pct": report.get("recycling_pct", ""),
        "billing_method": report.get("billing_method", ""),
        "review_candidate": _review_candidate_label(report.get("review_candidate")),
        "hours_match": "Yes" if report.get("hours_match") else "No",
        "hours_verified": _yes_no_blank(report.get("hours_verified")),
        "hours_mismatch_reason": report.get("hours_mismatch_reason", "") or "",
        "has_crew_feedback": _yes_no_blank(report.get("has_crew_feedback")),
        "crew_feedback": report.get("crew_feedback", "") or "",
        "employee_hours": _format_employee_hours(report.get("employee_hours")),
        "has_non_billable_hours": _has_non_billable(report.get("employee_hours")),
        # Per-diem: $50/day per crew member when the whole crew is out of town.
        "per_diem_total": _per_diem_total(report),
        "job_type_tags": ", ".join(report.get("job_type_tags") or []),
        "truck_fullness": _format_truck_fullness(report.get("truck_fullness")),
        # Derived from the actual inventory (blank when none collected).
        "furniture_count": report.get("furniture_count", ""),
        "box_count": report.get("box_count", ""),
        # Total billable man-hours for the job (standalone metric).
        "actual_man_hours": _actual_man_hours,
        "overage_note": report.get("overage_note", "") or "",
        "created_at": _iso(report.get("created_at")),
        "updated_at": _iso(report.get("updated_at")),
        "entered_by": entered_by,
        "entered_on": entered_on,
    }

    # Build the svc once and reuse for delete + ensure_tab + append so we
    # share one TLS connection per call.
    svc = _get_sheets_svc(db)

    # Ensure the tab + headers exist before deleting (a fresh staging
    # spreadsheet may not have the JobReports tab yet) so the lookup in
    # _delete_sheet_rows_by_value finds the job_uuid column.
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, JOB_REPORT_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "job_uuid", job_uuid)

    rows = [_build_row(row, actual_headers)]

    def _append():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    _api(_append)
    return 1


# ── Bills ────────────────────────────────────────────────────────────────────

BILL_HEADERS = [
    "job_uuid", "saved_by", "item_label", "item_qty", "item_unit", "item_rate",
    "item_discount_pct", "item_amount", "item_source",
    "global_discount_pct", "bill_notes", "updated_at",
    "entered_by", "entered_on",
    # Populated only for rows generated from a materials submission (one row
    # per submission via export_materials_to_bills_sheet). Empty for rows
    # the crew added in the bill calculator. Used as the delete key when a
    # materials submission is updated or removed.
    "submission_id",
]


def export_bill_to_sheets(db: Session, bill: Dict[str, Any]) -> int:
    tab = os.getenv("SHEETS_BILLS_TAB", "Bills").strip() or "Bills"
    job_uuid = bill.get("job_uuid", "")
    updated_at = _iso(bill.get("updated_at"))
    items = bill.get("items") or []
    entered_by, entered_on = _entry_status_for(db, job_uuid)

    rows: List[Dict[str, Any]] = []
    keys: List[str] = []
    for idx, it in enumerate(items):
        item_id = it.get("id") or f"idx{idx}"
        key = f"{job_uuid}:{updated_at}:{item_id}"
        if _generic_already_exported(db, "bill", key):
            continue
        qty = it.get("qty", 0) or 0
        rate = it.get("rate", 0) or 0
        discount = it.get("discount", 0) or 0
        amount = round(qty * rate * (1 - (discount / 100.0)), 2)
        rows.append({
            "job_uuid": job_uuid,
            "saved_by": bill.get("saved_by_name", "") or "",
            "item_label": it.get("label", ""),
            "item_qty": qty,
            "item_unit": it.get("unit", ""),
            "item_rate": rate,
            "item_discount_pct": discount,
            "item_amount": amount,
            "item_source": it.get("source", ""),
            "global_discount_pct": bill.get("global_discount", 0) or 0,
            "bill_notes": bill.get("notes", "") or "",
            "updated_at": updated_at,
            "entered_by": entered_by,
            "entered_on": entered_on,
            "submission_id": "",
        })
        keys.append(key)

    written = _append_rows(db, tab, BILL_HEADERS, rows)
    if written:
        _generic_mark_exported(db, "bill", keys)
    return written


def _job_materials_marker(job_uuid: str) -> str:
    """The submission_id column value for the aggregated materials line in
    the Bills sheet. Stable per job, so a re-sum overwrites in place.
    Distinct from any real submission_id (which is a UUID, no colons),
    so this can't collide with a row written for an individual submission."""
    return f"materials:{job_uuid}"


def rebuild_job_materials_total_in_bills(db: Session, job_uuid: str) -> int:
    """Recalculate the Bills sheet's single "Materials" line for a job:
    sum every materials submission's total for `job_uuid`, delete any prior
    Materials line for this job, and write one fresh row carrying the new
    total. Returns 1 if a row was written, 0 if the job has no materials
    (in which case any prior row is still removed).

    Called on every materials POST and DELETE so the Bills view always
    reflects the current sum - invoiced as a single line, not a stack of
    per-add rows.
    """
    if not job_uuid:
        return 0

    from app.db.models.materials import MaterialsSubmission  # local import - avoid module-load cycle

    rows = (
        db.query(MaterialsSubmission.total)
        .filter(MaterialsSubmission.job_uuid == job_uuid)
        .all()
    )
    total = 0.0
    for (t,) in rows:
        try:
            total += float(t or 0)
        except (TypeError, ValueError):
            pass
    total = round(total, 2)

    tab = os.getenv("SHEETS_BILLS_TAB", "Bills").strip() or "Bills"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    marker = _job_materials_marker(job_uuid)

    svc = _get_sheets_svc(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, BILL_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "submission_id", marker)

    if total <= 0:
        # No materials left for this job - leave the Bills sheet without a
        # zero-value "Materials" row. Itemized history still lives in the
        # Materials sheet for audit.
        return 0

    entered_by, entered_on = _entry_status_for(db, job_uuid)
    row = {
        "job_uuid": job_uuid,
        "saved_by": "",
        "item_label": "Materials",
        "item_qty": 1,
        "item_unit": "",
        "item_rate": total,
        "item_discount_pct": 0,
        "item_amount": total,
        "item_source": "materials",
        "global_discount_pct": 0,
        "bill_notes": "",
        "updated_at": _iso(datetime.utcnow()),
        "entered_by": entered_by,
        "entered_on": entered_on,
        "submission_id": marker,
    }
    sheet_rows = [_build_row(row, actual_headers)]

    def _append():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": sheet_rows},
        ).execute()

    _api(_append)
    return 1


# ── DVIRs ────────────────────────────────────────────────────────────────────

DVIR_HEADERS = [
    "dvir_id", "phase", "inspection_type", "inspection_date",
    "vehicle_number", "trailer_number", "odometer",
    "driver_name", "condition", "defects", "defect_notes",
    "back_of_truck_confirmed", "overnight_hold",
    "mechanic_name", "repairs_made", "mechanic_notes",
    "driver_signed_at", "mechanic_signed_at", "created_at",
]


def _dvir_row(d: Dict[str, Any], phase: str) -> Dict[str, Any]:
    defects = d.get("defects")
    if isinstance(defects, list):
        defects_str = ", ".join(defects)
    elif isinstance(defects, str):
        defects_str = defects
    else:
        defects_str = ""
    return {
        "dvir_id": d.get("dvir_id", ""),
        "phase": phase,   # "driver" or "mechanic"
        "inspection_type": d.get("inspection_type", ""),
        "inspection_date": d.get("inspection_date", ""),
        "vehicle_number": d.get("vehicle_number", ""),
        "trailer_number": d.get("trailer_number", "") or "",
        "odometer": d.get("odometer", "") if d.get("odometer") is not None else "",
        "driver_name": d.get("driver_name", ""),
        "condition": d.get("condition", ""),
        "defects": defects_str,
        "defect_notes": d.get("defect_notes", "") or "",
        "back_of_truck_confirmed":
            "" if d.get("back_of_truck_confirmed") is None
            else ("Yes" if d.get("back_of_truck_confirmed") else "No"),
        "overnight_hold":
            "" if d.get("overnight_hold") is None
            else ("Yes" if d.get("overnight_hold") else "No"),
        "mechanic_name": d.get("mechanic_name", "") or "",
        "repairs_made":
            "" if d.get("repairs_made") is None
            else ("Yes" if d.get("repairs_made") else "No"),
        "mechanic_notes": d.get("mechanic_notes", "") or "",
        "driver_signed_at": _iso(d.get("driver_signed_at")),
        "mechanic_signed_at": _iso(d.get("mechanic_signed_at")),
        "created_at": _iso(d.get("created_at")),
    }


def export_dvir_to_sheets(db: Session, dvir: Dict[str, Any], phase: str = "driver") -> int:
    """phase: "driver" on initial submit, "mechanic" after mechanic sign-off."""
    tab = os.getenv("SHEETS_DVIRS_TAB", "DVIRs").strip() or "DVIRs"
    dvir_id = dvir.get("dvir_id", "")
    key = f"{dvir_id}:{phase}"
    if _generic_already_exported(db, "dvir", key):
        return 0
    row = _dvir_row(dvir, phase)
    written = _append_rows(db, tab, DVIR_HEADERS, [row])
    if written:
        _generic_mark_exported(db, "dvir", [key])
    return written


# ── Prior On-Duty Hours Statements ───────────────────────────────────────────

PRIOR_HOURS_HEADERS = [
    "statement_id", "driver_name", "statement_date", "hours_last_24",
    "total_last_7", "daily_breakdown", "signed_at", "created_at",
]


def export_prior_hours_to_sheets(db: Session, statement: Dict[str, Any]) -> int:
    tab = os.getenv("SHEETS_PRIOR_HOURS_TAB", "PriorOnDuty").strip() or "PriorOnDuty"
    key = statement.get("statement_id", "")
    if not key or _generic_already_exported(db, "prior_hours", key):
        return 0

    daily = statement.get("daily_hours") or []
    total = 0.0
    daily_bits = []
    for entry in daily:
        try:
            hrs = float(entry.get("hours", 0) or 0)
        except Exception:
            hrs = 0.0
        total += hrs
        daily_bits.append(f"{entry.get('date','')}={hrs}")

    row = {
        "statement_id": key,
        "driver_name": statement.get("driver_name", ""),
        "statement_date": statement.get("statement_date", ""),
        "hours_last_24": statement.get("hours_last_24", ""),
        "total_last_7": round(total, 2),
        "daily_breakdown": "; ".join(daily_bits),
        "signed_at": _iso(statement.get("signed_at")),
        "created_at": _iso(statement.get("created_at")),
    }
    written = _append_rows(db, tab, PRIOR_HOURS_HEADERS, [row])
    if written:
        _generic_mark_exported(db, "prior_hours", [key])
    return written


# ── RODS ─────────────────────────────────────────────────────────────────────

RODS_HEADERS = [
    "rods_id", "log_date", "driver_name", "co_driver_name",
    "vehicle_number", "trailer_number", "origin", "destination",
    "total_miles", "shipping_docs", "carrier", "main_office_address",
    "total_off_duty", "total_sleeper", "total_driving", "total_on_duty",
    "duty_changes", "remarks", "signed_at", "created_at",
]


def export_rods_to_sheets(db: Session, rods: Dict[str, Any]) -> int:
    tab = os.getenv("SHEETS_RODS_TAB", "RODS").strip() or "RODS"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    key = rods.get("rods_id", "")
    if not key:
        return 0

    changes = rods.get("duty_changes") or []
    duty_str = " | ".join(
        f"{c.get('time','')} {c.get('status','')}"
        + (f" @ {c.get('location','')}" if c.get("location") else "")
        + (f" - {c.get('remarks','')}" if c.get("remarks") else "")
        for c in changes
    )

    row = {
        "rods_id": key,
        "log_date": rods.get("log_date", ""),
        "driver_name": rods.get("driver_name", ""),
        "co_driver_name": rods.get("co_driver_name", "") or "",
        "vehicle_number": rods.get("vehicle_number", "") or "",
        "trailer_number": rods.get("trailer_number", "") or "",
        "origin": rods.get("origin", "") or "",
        "destination": rods.get("destination", "") or "",
        "total_miles": rods.get("total_miles", "") or "",
        "shipping_docs": rods.get("shipping_docs", "") or "",
        "carrier": rods.get("carrier", "") or "",
        "main_office_address": rods.get("main_office_address", "") or "",
        "total_off_duty": rods.get("total_off_duty", "") or "",
        "total_sleeper": rods.get("total_sleeper", "") or "",
        "total_driving": rods.get("total_driving", "") or "",
        "total_on_duty": rods.get("total_on_duty", "") or "",
        "duty_changes": duty_str,
        "remarks": rods.get("remarks", "") or "",
        "signed_at": _iso(rods.get("signed_at")),
        "created_at": _iso(rods.get("created_at")),
    }

    # Replace strategy: a RODS day is upserted (the recorder appends changes and
    # re-submits through the day), so delete any existing row for this rods_id
    # and write the current state, guaranteeing exactly one row per day.
    svc = _get_sheets_svc(db)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "rods_id", key)
    db.execute(
        text("DELETE FROM sheet_generic_exports WHERE kind = 'rods' AND export_key = :k"),
        {"k": key},
    )
    db.commit()

    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, RODS_HEADERS)
    _write_rows_top(svc, spreadsheet_id, tab, [_build_row(row, actual_headers)])
    _generic_mark_exported(db, "rods", [key])
    return 1


# ── Long-distance per-diem / drive-day (payroll) ─────────────────────────────

LD_DAY_HEADERS = [
    "day_id", "date", "driver_name", "job_name", "job_uuid",
    "out_of_town", "drive_day", "per_diem", "updated_at",
]


def export_ld_day_to_sheets(db: Session, day: Dict[str, Any]) -> int:
    """One row per driver/day (replace-style, upserted). Admin tallies per-diem
    ($50 × out-of-town days) and drive days per employee from this tab."""
    tab = os.getenv("SHEETS_LD_PAY_TAB", "LongDistancePay").strip() or "LongDistancePay"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    key = day.get("day_id", "")
    if not key:
        return 0

    row = {
        "day_id": key,
        "date": day.get("date", ""),
        "driver_name": day.get("driver_name", ""),
        "job_name": day.get("job_name", "") or "",
        "job_uuid": day.get("job_uuid", "") or "",
        "out_of_town": "Yes" if day.get("out_of_town") else "No",
        "drive_day": "Yes" if day.get("drive_day") else "No",
        "per_diem": day.get("per_diem", 0),
        "updated_at": _iso(day.get("updated_at")),
    }

    svc = _get_sheets_svc(db)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "day_id", key)
    db.execute(
        text("DELETE FROM sheet_generic_exports WHERE kind = 'ld_day' AND export_key = :k"),
        {"k": key},
    )
    db.commit()

    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, LD_DAY_HEADERS)
    _write_rows_top(svc, spreadsheet_id, tab, [_build_row(row, actual_headers)])
    _generic_mark_exported(db, "ld_day", [key])
    return 1


# ── Estimates ────────────────────────────────────────────────────────────────

ESTIMATE_HEADERS = [
    "estimate_uuid", "created_by", "customer_name", "customer_email",
    "customer_phone", "move_date", "origin_address", "destination_address",
    "origin_access_notes", "destination_access_notes",
    "special_items_notes", "general_notes",
    "estimated_hours", "job_uuid",
    "estimated_weight_lbs", "estimated_cubic_ft", "item_count",
    "created_at", "updated_at",
]

ESTIMATE_ITEM_HEADERS = [
    "estimate_uuid", "customer_name", "item_id", "room", "subcategory",
    "item_name", "qty", "weight_lbs_each", "cubic_ft_each",
    "total_weight_lbs", "total_cubic_ft", "notes", "exported_at",
]

# Digital Bill of Lading - one summary row per BOL, one row per item. Replace
# strategy (delete-before-write by bol_id), same as estimates.
BOL_HEADERS = [
    "bol_id", "created_by", "job_uuid", "job_name", "job_date",
    "status", "item_count",
    "shipment_number", "shipper_name", "shipper_phone", "shipper_address",
    "origin_address", "destination_address",
    "form_of_payment", "estimate_type", "valuation",
    "agreed_pickup", "agreed_delivery",
    "inventory_verified", "inventory_note",
    "origin_signed_at", "dest_signed_at", "final_charges",
    "walkthrough_notes", "signed_pdf_url",
    "created_at", "updated_at",
]

# Human labels for the coded BOL option fields, so the office sheet reads plainly.
# Keep in sync with frontend/src/lib/bolContract.ts option maps.
_BOL_FORM_OF_PAYMENT = {
    "cash": "Cash", "check": "Check", "credit_card": "Credit card",
    "cod": "Collect on delivery (COD)", "other": "Other",
}
_BOL_ESTIMATE_TYPE = {"binding": "Binding", "non_binding": "Non-binding"}
_BOL_VALUATION = {
    "full_value": "Full Value Protection",
    "released": "Released Value (60 cents per pound, per article)",
}

BOL_ITEM_HEADERS = [
    "bol_id", "job_name", "job_date", "item_no", "item_name",
    "qty", "packed_by", "condition_notes", "photo_links", "exported_at",
]


def _delete_sheet_rows_by_value(
    svc: Any,
    spreadsheet_id: str,
    tab: str,
    col_name: str,
    target_value: str,
) -> int:
    """Delete every row in `tab` where the `col_name` cell equals
    `target_value`. Used by replace-style exports (estimates, job reports)
    to guarantee exactly one row per logical entity regardless of how
    many times it's saved.

    Returns the number of rows deleted. No-op if the tab doesn't exist
    yet, the column isn't present, or no rows match."""
    sheet_ids = _sheet_ids(svc, spreadsheet_id)
    if tab not in sheet_ids:
        sheet_ids = _sheet_ids(svc, spreadsheet_id, refresh=True)
        if tab not in sheet_ids:
            return 0
    sheet_numeric_id = sheet_ids[tab]

    hdr = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!1:1"
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0]
    if col_name not in headers_row:
        return 0
    col_letter = _col_letter(headers_row.index(col_name))

    col = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!{col_letter}:{col_letter}"
    ).execute())
    col_values = col.get("values") or []

    target_indices = [
        i for i, row in enumerate(col_values)
        if i > 0 and (row[0] if row else "") == target_value
    ]
    if not target_indices:
        return 0

    requests = [
        {"deleteDimension": {"range": {
            "sheetId": sheet_numeric_id,
            "dimension": "ROWS",
            "startIndex": idx,
            "endIndex": idx + 1,
        }}}
        for idx in sorted(target_indices, reverse=True)
    ]
    _api(lambda: svc.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute())
    return len(target_indices)


def _delete_bol_stale_rows(
    svc: Any,
    spreadsheet_id: str,
    tab: str,
    id_col: str,
    id_val: str,
    ts_col: str,
    keep_ts: str,
) -> int:
    """Delete rows in `tab` where `id_col` == `id_val` AND `ts_col` != `keep_ts`.

    Backs the BOL export's write-first-then-delete-stale ordering (bug 4 / ADR
    0020): the freshly-written rows carry `keep_ts` and are preserved; older rows
    for the same bol_id are removed. Reading only the two key columns keeps this
    off the whole-tab read path. No-op if the tab / columns are absent."""
    sheet_numeric_id = _sheet_numeric_id(svc, spreadsheet_id, tab)
    if sheet_numeric_id is None:
        return 0

    hdr = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!1:1"
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0]
    if id_col not in headers_row or ts_col not in headers_row:
        return 0
    id_idx = headers_row.index(id_col)
    ts_idx = headers_row.index(ts_col)
    lo, hi = min(id_idx, ts_idx), max(id_idx, ts_idx)
    res = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f"{tab}!{_col_letter(lo)}:{_col_letter(hi)}"
    ).execute())
    values = res.get("values") or []
    id_at, ts_at = id_idx - lo, ts_idx - lo

    stale: List[int] = []
    for i, row in enumerate(values):
        if i == 0:
            continue  # header
        rid = row[id_at] if len(row) > id_at else ""
        rts = row[ts_at] if len(row) > ts_at else ""
        if rid == id_val and rts != keep_ts:
            stale.append(i)
    if not stale:
        return 0

    requests = [
        {"deleteDimension": {"range": {
            "sheetId": sheet_numeric_id,
            "dimension": "ROWS",
            "startIndex": idx,
            "endIndex": idx + 1,
        }}}
        for idx in sorted(stale, reverse=True)
    ]
    _api(lambda: svc.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute())
    return len(stale)


def _delete_estimate_sheet_rows(
    svc: Any,
    spreadsheet_id: str,
    tabs: List[str],
    estimate_uuid: str,
) -> None:
    """Delete all rows for `estimate_uuid` from each tab. col_name is always
    'estimate_uuid' in both Estimates and EstimateItems tabs."""
    for tab in tabs:
        _delete_sheet_rows_by_value(
            svc, spreadsheet_id, tab, "estimate_uuid", estimate_uuid,
        )


def export_estimate_to_sheets(db: Session, estimate: Dict[str, Any]) -> int:
    """Writes one summary row to Estimates and one row per item to EstimateItems,
    always reflecting the current state of the estimate (replace strategy -
    existing rows for this estimate_uuid are deleted before writing fresh ones).
    This guarantees exactly 1 summary row and N item rows per estimate regardless
    of how many times it is saved."""
    summary_tab = os.getenv("SHEETS_ESTIMATES_TAB", "Estimates").strip() or "Estimates"
    items_tab = os.getenv("SHEETS_ESTIMATE_ITEMS_TAB", "EstimateItems").strip() or "EstimateItems"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    estimate_uuid = estimate.get("estimate_uuid", "")
    updated_at = _iso(estimate.get("updated_at"))

    svc = _get_sheets_svc(db)

    # Delete any existing rows for this estimate so we always have exactly one
    # summary row and one row per current item (no accumulation on each save).
    _delete_estimate_sheet_rows(svc, spreadsheet_id, [summary_tab, items_tab], estimate_uuid)

    # Clear all dedup entries so the fresh rows are accepted by _generic_already_exported.
    db.execute(
        text(
            "DELETE FROM sheet_generic_exports "
            "WHERE kind IN ('estimate', 'estimate_item') AND export_key LIKE :prefix"
        ),
        {"prefix": f"{estimate_uuid}:%"},
    )
    db.commit()

    total_written = 0
    summary_key = f"{estimate_uuid}:{updated_at}"

    # Summary row
    items = estimate.get("items") or []
    summary_row = {
        "estimate_uuid": estimate_uuid,
        "created_by": estimate.get("created_by_name", "") or "",
        "customer_name": estimate.get("customer_name", ""),
        "customer_email": estimate.get("customer_email", "") or "",
        "customer_phone": estimate.get("customer_phone", "") or "",
        "move_date": estimate.get("move_date", "") or "",
        "origin_address": estimate.get("origin_address", "") or "",
        "destination_address": estimate.get("destination_address", "") or "",
        "origin_access_notes": estimate.get("origin_access_notes", "") or "",
        "destination_access_notes": estimate.get("destination_access_notes", "") or "",
        "special_items_notes": estimate.get("special_items_notes", "") or "",
        "general_notes": estimate.get("general_notes", "") or "",
        "estimated_hours": estimate.get("estimated_hours") if estimate.get("estimated_hours") is not None else "",
        "job_uuid": estimate.get("job_uuid", "") or "",
        "estimated_weight_lbs": round(estimate.get("estimated_weight_lbs", 0) or 0, 2),
        "estimated_cubic_ft": round(estimate.get("estimated_cubic_ft", 0) or 0, 2),
        "item_count": sum(it.get("qty", 1) or 1 for it in items),
        "created_at": _iso(estimate.get("created_at")),
        "updated_at": updated_at,
    }
    actual_summary_headers = _ensure_tab(svc, spreadsheet_id, summary_tab, ESTIMATE_HEADERS)
    rows = [_build_row(summary_row, actual_summary_headers)]

    _write_rows_top(svc, spreadsheet_id, summary_tab, rows)
    _generic_mark_exported(db, "estimate", [summary_key])
    total_written += 1

    # Item rows - one per current item
    if items:
        customer_name = estimate.get("customer_name", "")
        item_rows: List[Dict[str, Any]] = []
        item_keys: List[str] = []
        for it in items:
            item_id = it.get("id")
            qty = it.get("qty", 0) or 0
            w = it.get("weight_lbs", 0) or 0
            v = it.get("cubic_ft", 0) or 0
            item_rows.append({
                "estimate_uuid": estimate_uuid,
                "customer_name": customer_name,
                "item_id": item_id,
                "room": it.get("room", "") or "",
                "subcategory": it.get("subcategory", "") or "",
                "item_name": it.get("name", ""),
                "qty": qty,
                "weight_lbs_each": w,
                "cubic_ft_each": v,
                "total_weight_lbs": round(w * qty, 2),
                "total_cubic_ft": round(v * qty, 2),
                "notes": it.get("notes", "") or "",
                "exported_at": updated_at,
            })
            item_keys.append(f"{estimate_uuid}:{item_id}:{updated_at}")

        actual_item_headers = _ensure_tab(svc, spreadsheet_id, items_tab, ESTIMATE_ITEM_HEADERS)
        item_sheet_rows = [_build_row(r, actual_item_headers) for r in item_rows]

        _write_rows_top(svc, spreadsheet_id, items_tab, item_sheet_rows)
        _generic_mark_exported(db, "estimate_item", item_keys)
        total_written += len(item_rows)

    return total_written


def export_bol_to_sheets(db: Session, bol: Dict[str, Any]) -> int:
    """Write one summary row to the BOLs tab and one row per item to the
    BOLItems tab, always reflecting the current state of the BOL. Replace
    strategy - existing rows for this bol_id are deleted before writing fresh
    ones - so re-submits (photo-link backfill, later signing) never duplicate.
    Modeled on export_estimate_to_sheets."""
    summary_tab = os.getenv("SHEETS_BOLS_TAB", "BOLs").strip() or "BOLs"
    items_tab = os.getenv("SHEETS_BOL_ITEMS_TAB", "BOLItems").strip() or "BOLItems"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    bol_id = bol.get("bol_id") or bol.get("id") or ""
    if not bol_id:
        return 0
    updated_at = _iso(bol.get("updated_at"))
    export_key = f"{bol_id}:{updated_at}"

    # Idempotency: if this exact (bol_id, updated_at) is already recorded as
    # exported, this is a duplicate delivery (a coalescer re-run or the reconciler
    # on an unchanged BOL). Do nothing - the write-first ordering below only
    # deletes rows with a DIFFERENT timestamp, so re-writing an unchanged state
    # would stack a second copy.
    already = db.execute(
        text("SELECT 1 FROM sheet_generic_exports WHERE kind = 'bol' AND export_key = :k LIMIT 1"),
        {"k": export_key},
    ).first()
    if already is not None:
        return 0

    svc = _get_sheets_svc(db)
    items = bol.get("items") or []

    # Summary row
    summary_row = {
        "bol_id": bol_id,
        "created_by": bol.get("created_by", "") or "",
        "job_uuid": bol.get("job_uuid", "") or "",
        "job_name": bol.get("job_name", "") or "",
        "job_date": bol.get("job_date", "") or "",
        "status": bol.get("status", "") or "",
        "item_count": sum(int(it.get("qty", 1) or 1) for it in items),
        # FMCSA 375.505 fields (from shipment_json). Surfacing them here keeps
        # admin's view complete; coded fields render as human labels (ADR 0023).
        "shipment_number": (bol.get("shipment") or {}).get("shipment_number", "") or "",
        "shipper_name": (bol.get("shipment") or {}).get("shipper_name", "") or "",
        "shipper_phone": (bol.get("shipment") or {}).get("shipper_phone", "") or "",
        "shipper_address": (bol.get("shipment") or {}).get("shipper_address", "") or "",
        "origin_address": (bol.get("shipment") or {}).get("origin_address", "") or "",
        "destination_address": (bol.get("shipment") or {}).get("dest_address", "") or "",
        "form_of_payment": _BOL_FORM_OF_PAYMENT.get(
            (bol.get("shipment") or {}).get("form_of_payment", ""),
            (bol.get("shipment") or {}).get("form_of_payment", "") or "",
        ),
        "estimate_type": _BOL_ESTIMATE_TYPE.get(
            (bol.get("shipment") or {}).get("estimate_type", ""),
            (bol.get("shipment") or {}).get("estimate_type", "") or "",
        ),
        "valuation": _BOL_VALUATION.get(
            (bol.get("shipment") or {}).get("valuation", ""),
            (bol.get("shipment") or {}).get("valuation", "") or "",
        ),
        "agreed_pickup": (bol.get("shipment") or {}).get("agreed_pickup", "") or "",
        "agreed_delivery": (bol.get("shipment") or {}).get("agreed_delivery", "") or "",
        "inventory_verified": (
            "yes" if bol.get("inventory_verified") is True
            else "no" if bol.get("inventory_verified") is False
            else ""
        ),
        "inventory_note": bol.get("inventory_note", "") or "",
        "origin_signed_at": _iso(bol.get("origin_signed_at")) if bol.get("origin_signed_at") else "",
        "dest_signed_at": _iso(bol.get("dest_signed_at")) if bol.get("dest_signed_at") else "",
        "final_charges": bol.get("final_charges") if bol.get("final_charges") is not None else "",
        "walkthrough_notes": bol.get("walkthrough_notes", "") or "",
        "signed_pdf_url": bol.get("signed_pdf_url", "") or "",
        "created_at": _iso(bol.get("created_at")),
        "updated_at": updated_at,
    }
    actual_summary_headers = _ensure_tab(svc, spreadsheet_id, summary_tab, BOL_HEADERS)

    # Build item rows up front so all writes happen together, before any delete.
    item_rows: List[Dict[str, Any]] = []
    item_keys: List[str] = []
    actual_item_headers: Optional[List[str]] = None
    if items:
        job_name = bol.get("job_name", "") or ""
        job_date = bol.get("job_date", "") or ""
        for it in items:
            item_id = it.get("id", "")
            photos = it.get("photos") or []
            photo_links = ", ".join(
                p.get("drive_url", "") for p in photos if p.get("drive_url")
            )
            packed_by_raw = str(it.get("packed_by", "") or "").lower()
            packed_by_label = (
                "CP" if packed_by_raw == "cp"
                else "PBO" if packed_by_raw == "pbo"
                else ""
            )
            item_rows.append({
                "bol_id": bol_id,
                "job_name": job_name,
                "job_date": job_date,
                "item_no": it.get("item_no", ""),
                "item_name": it.get("name", ""),
                "qty": it.get("qty", 0) or 0,
                "packed_by": packed_by_label,
                "condition_notes": it.get("condition_notes", "") or "",
                "photo_links": photo_links,
                "exported_at": updated_at,
            })
            item_keys.append(f"{bol_id}:{item_id}:{updated_at}")
        actual_item_headers = _ensure_tab(svc, spreadsheet_id, items_tab, BOL_ITEM_HEADERS)

    # WRITE FIRST, delete stale after (bug 4 / ADR 0020). The old ordering deleted
    # every row for this bol_id BEFORE writing, so an exception in between left
    # the sheet with NO row for a signed BOL that previously had one. Writing
    # first means a mid-export crash leaves at worst a DUPLICATE (visible, never a
    # gap in a signed legal document's record). A different-timestamp duplicate is
    # removed by _delete_bol_stale_rows below; a same-timestamp duplicate (a rare
    # re-export of an unchanged state) is only cleared by the next real change to
    # the BOL, which is acceptable - a visible duplicate, not a loss.
    #
    # CRUCIAL: write the summary AND the item rows to the sheet BEFORE marking the
    # `bol` dedupe key. The item rows are the BOL's declared inventory (the legally
    # meaningful contents), and the item write is the slow multi-call that a worker
    # recycle / OOM is most likely to interrupt. If we marked `bol` first (as an
    # earlier version did) and then died before the item write, the reconciler, the
    # drift check, and the idempotency skip ALL key on the `bol` dedupe row - so a
    # summary-present / items-missing BOL would be silently un-recoverable. Marking
    # only after both writes means a crash there leaves NO dedupe row, so the
    # reconciler re-selects and re-ships the BOL (a recoverable duplicate, not a
    # silent item loss).
    _write_rows_top(svc, spreadsheet_id, summary_tab, [_build_row(summary_row, actual_summary_headers)])
    total_written = 1
    if item_rows and actual_item_headers is not None:
        item_sheet_rows = [_build_row(r, actual_item_headers) for r in item_rows]
        _write_rows_top(svc, spreadsheet_id, items_tab, item_sheet_rows)
        total_written += len(item_rows)
    # Both tabs are now written; record the dedupe keys together.
    _generic_mark_exported(db, "bol", [export_key])
    if item_keys:
        _generic_mark_exported(db, "bol_item", item_keys)

    # Now remove the STALE rows for this bol_id: any row whose timestamp differs
    # from the fresh write. The just-written rows carry `updated_at` and survive.
    _delete_bol_stale_rows(svc, spreadsheet_id, summary_tab, "bol_id", bol_id, "updated_at", updated_at)
    _delete_bol_stale_rows(svc, spreadsheet_id, items_tab, "bol_id", bol_id, "exported_at", updated_at)
    # Drop stale dedup entries for this bol_id, keeping the current-timestamp keys
    # (both `bol_id:updated_at` and `bol_id:item_id:updated_at` end with the ts).
    db.execute(
        text(
            "DELETE FROM sheet_generic_exports "
            "WHERE kind IN ('bol', 'bol_item') "
            "AND export_key LIKE :prefix AND export_key NOT LIKE :cur"
        ),
        {"prefix": f"{bol_id}:%", "cur": f"%:{updated_at}"},
    )
    db.commit()

    return total_written


def _build_estimate_payload(db: Session, estimate_uuid: str) -> Optional[Dict[str, Any]]:
    from app.db.models.estimate import Estimate  # local import to avoid cycles
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if e is None:
        return None
    return {
        "estimate_uuid": e.estimate_uuid,
        "created_by_name": e.created_by_name,
        "customer_name": e.customer_name,
        "customer_email": e.customer_email,
        "customer_phone": e.customer_phone,
        "move_date": e.move_date,
        "origin_address": e.origin_address,
        "destination_address": e.destination_address,
        "origin_access_notes": e.origin_access_notes,
        "destination_access_notes": e.destination_access_notes,
        "special_items_notes": e.special_items_notes,
        "general_notes": e.general_notes,
        "estimated_hours": e.estimated_hours,
        "job_uuid": e.job_uuid,
        "estimated_weight_lbs": e.estimated_weight_lbs,
        "estimated_cubic_ft": e.estimated_cubic_ft,
        "created_at": e.created_at,
        "updated_at": e.updated_at,
        "items": [
            {
                "id": it.id,
                "name": it.name,
                "qty": it.qty,
                "weight_lbs": it.weight_lbs,
                "cubic_ft": it.cubic_ft,
                "room": it.room,
                "subcategory": it.subcategory,
                "notes": it.notes,
            }
            for it in e.items
        ],
    }


def delete_estimate_from_sheets(db: Session, estimate_uuid: str) -> int:
    """Remove a deleted estimate's summary + item rows from the sheet so it
    doesn't leave ghost rows. Mirrors the delete phase of
    export_estimate_to_sheets and is safe to run repeatedly (deletes by
    estimate_uuid; clears the dedup markers too)."""
    if not estimate_uuid:
        return 0
    summary_tab = os.getenv("SHEETS_ESTIMATES_TAB", "Estimates").strip() or "Estimates"
    items_tab = os.getenv("SHEETS_ESTIMATE_ITEMS_TAB", "EstimateItems").strip() or "EstimateItems"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    svc = _get_sheets_svc(db)
    _delete_estimate_sheet_rows(svc, spreadsheet_id, [summary_tab, items_tab], estimate_uuid)
    db.execute(
        text(
            "DELETE FROM sheet_generic_exports "
            "WHERE kind IN ('estimate', 'estimate_item') AND export_key LIKE :prefix"
        ),
        {"prefix": f"{estimate_uuid}:%"},
    )
    db.commit()
    return 1


def _estimate_export_worker(estimate_uuid: str) -> None:
    from app.db.session import SessionLocal
    # Loop until no rerun flag was set while the previous export was running.
    # Bounds queue growth: at most one in-flight export + one pending rerun
    # marker per estimate_uuid, regardless of how many PATCHes stream in.
    while True:
        # Retry the full export a few times on failure. export_estimate_to_sheets
        # is a delete-then-rewrite replace (it clears all rows for this estimate
        # before writing summary + item rows), so re-running it is idempotent -
        # this ensures a transient Google/SSL error on the second (items) write
        # can't leave a summary row permanently stranded without its item rows.
        # Each attempt uses a fresh session and re-reads the latest DB state.
        for attempt in range(3):
            db = SessionLocal()
            try:
                payload = _build_estimate_payload(db, estimate_uuid)
                if payload is None:
                    # Estimate was deleted - remove its stale summary + item rows
                    # so a deleted estimate doesn't leave ghost rows behind.
                    delete_estimate_from_sheets(db, estimate_uuid)
                    record_sheet_sync(db, "export_estimate_to_sheets", True)
                    break
                export_estimate_to_sheets(db, payload)
                record_sheet_sync(db, "export_estimate_to_sheets", True)
                break  # success
            except Exception as exc:
                try:
                    db.rollback()
                except Exception:
                    pass
                if attempt >= 2:
                    record_sheet_sync(db, "export_estimate_to_sheets", False, str(exc))
                if attempt >= 2:
                    print(f"[sheets] estimate export failed after retries ({estimate_uuid}): {exc}")
                else:
                    print(f"[sheets] estimate export retry {attempt + 1} ({estimate_uuid}): {exc}")
                    time.sleep(0.75 * (attempt + 1))
            finally:
                try:
                    db.close()
                except Exception:
                    pass

        with _estimate_export_lock:
            if estimate_uuid in _estimate_export_rerun:
                _estimate_export_rerun.discard(estimate_uuid)
                continue
            _estimate_export_in_flight.discard(estimate_uuid)
            return


def schedule_estimate_export(estimate_uuid: str) -> None:
    """Coalesce repeated export requests for the same estimate into a single
    in-flight worker with at most one pending rerun. Safe to call on every
    autosave keystroke - the worker re-reads the DB when it runs so the
    final export always reflects the latest committed state."""
    if not estimate_uuid:
        return
    with _estimate_export_lock:
        if estimate_uuid in _estimate_export_in_flight:
            _estimate_export_rerun.add(estimate_uuid)
            return
        _estimate_export_in_flight.add(estimate_uuid)
    _EXPORT_POOL.submit(_estimate_export_worker, estimate_uuid)


# ── Job inventory (actual inventory → furniture + box counts) ─────────────────

JOB_INVENTORY_HEADERS = [
    "job_uuid", "job_name", "submitted_by",
    "furniture_count", "box_count", "item_count",
    "updated_at",
]

JOB_INVENTORY_ITEM_HEADERS = [
    "job_uuid", "item_id", "kind", "item_name", "qty", "pack_type", "room", "notes",
    "exported_at",
]


def export_job_inventory_to_sheets(db: Session, inv: Dict[str, Any]) -> int:
    """Replace-style export: one summary row per job_uuid in JobInventory + one
    row per item in JobInventoryItems. Any prior rows for this job are deleted
    before the fresh set is written so re-saves overwrite in place."""
    summary_tab = os.getenv("SHEETS_JOB_INVENTORY_TAB", "JobInventory").strip() or "JobInventory"
    items_tab = os.getenv("SHEETS_JOB_INVENTORY_ITEMS_TAB", "JobInventoryItems").strip() or "JobInventoryItems"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    job_uuid = inv.get("job_uuid", "") or ""
    if not job_uuid:
        return 0

    items = inv.get("items") or []
    updated_at = _iso(inv.get("updated_at"))
    furniture_count = sum((it.get("qty", 0) or 0) for it in items if not it.get("is_box"))
    box_count = sum((it.get("qty", 0) or 0) for it in items if it.get("is_box"))

    svc = _get_sheets_svc(db)

    # Summary row (replace by job_uuid).
    summary_headers = _ensure_tab(svc, spreadsheet_id, summary_tab, JOB_INVENTORY_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, summary_tab, "job_uuid", job_uuid)
    summary_row = {
        "job_uuid": job_uuid,
        "job_name": inv.get("job_name", "") or "",
        "submitted_by": inv.get("submitted_by_name", "") or "",
        "furniture_count": furniture_count,
        "box_count": box_count,
        "item_count": sum((it.get("qty", 0) or 0) for it in items),
        "updated_at": updated_at,
    }
    _write_rows_top(svc, spreadsheet_id, summary_tab, [_build_row(summary_row, summary_headers)])

    # Item rows (replace by job_uuid).
    item_headers = _ensure_tab(svc, spreadsheet_id, items_tab, JOB_INVENTORY_ITEM_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, items_tab, "job_uuid", job_uuid)
    if items:
        item_rows = [
            _build_row({
                "job_uuid": job_uuid,
                "item_id": it.get("id"),
                "kind": "Box" if it.get("is_box") else "Furniture",
                "item_name": it.get("name", ""),
                "qty": it.get("qty", 0) or 0,
                "pack_type": it.get("pack_type", "") or "",
                "room": it.get("room", "") or "",
                "notes": it.get("notes", "") or "",
                "exported_at": updated_at,
            }, item_headers)
            for it in items
        ]
        _write_rows_top(svc, spreadsheet_id, items_tab, item_rows)

    return 1 + len(items)


def _build_job_inventory_payload(db: Session, job_uuid: str) -> Optional[Dict[str, Any]]:
    from app.db.models.job_inventory import JobInventoryItem  # local import to avoid cycles

    items = (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.job_uuid == job_uuid)
        .order_by(JobInventoryItem.id.asc())
        .all()
    )
    # Best-effort job name + latest submitter from the rows themselves.
    job_name = _job_name_from_events(db, job_uuid)
    submitted_by = items[-1].created_by_name if items else ""
    updated_at = max((it.updated_at for it in items), default=None)
    return {
        "job_uuid": job_uuid,
        "job_name": job_name,
        "submitted_by_name": submitted_by,
        "updated_at": updated_at,
        "items": [
            {
                "id": it.id,
                "name": it.name,
                "qty": it.qty,
                "is_box": bool(it.is_box),
                "pack_type": it.pack_type,
                "room": it.room,
                "notes": it.notes,
            }
            for it in items
        ],
    }


def _job_name_from_events(db: Session, job_uuid: str) -> str:
    from app.db.models.event import Event  # local import to avoid cycles
    row = (
        db.query(Event.job_name)
        .filter(Event.job_uuid == job_uuid, Event.job_name.isnot(None), Event.job_name != "")
        .order_by(Event.timestamp.desc())
        .first()
    )
    return row[0] if row and row[0] else ""


def _job_inventory_export_worker(job_uuid: str) -> None:
    from app.db.session import SessionLocal
    while True:
        db = SessionLocal()
        try:
            payload = _build_job_inventory_payload(db, job_uuid)
            if payload is not None:
                export_job_inventory_to_sheets(db, payload)
            # Record health the same way the estimate worker does. Without this
            # the sync's registry entries never get a last_ok_at / last_error, so
            # Admin > System Check reports it as fine forever and cannot see this
            # export silently failing.
            record_sheet_sync(db, "export_job_inventory_to_sheets", True)
        except Exception as exc:
            print(f"[sheets] job-inventory export failed ({job_uuid}): {exc}")
            record_sheet_sync(db, "export_job_inventory_to_sheets", False, str(exc))
        finally:
            try:
                db.close()
            except Exception:
                pass

        with _job_inventory_export_lock:
            if job_uuid in _job_inventory_export_rerun:
                _job_inventory_export_rerun.discard(job_uuid)
                continue
            _job_inventory_export_in_flight.discard(job_uuid)
            return


def schedule_job_inventory_export(job_uuid: str) -> None:
    """Coalesce repeated exports for the same job into one in-flight worker
    with at most one pending rerun. The worker re-reads the DB when it runs so
    the export always reflects the latest committed inventory."""
    if not job_uuid:
        return
    with _job_inventory_export_lock:
        if job_uuid in _job_inventory_export_in_flight:
            _job_inventory_export_rerun.add(job_uuid)
            return
        _job_inventory_export_in_flight.add(job_uuid)
    _EXPORT_POOL.submit(_job_inventory_export_worker, job_uuid)


# ── Incident export ──────────────────────────────────────────────────────────

INCIDENT_HEADERS = [
    "incident_uuid", "claim_number", "incident_date", "job_uuid", "job_name",
    "reported_by", "attributed_crew", "severity", "attributable", "description",
    "est_cost", "resolved", "notes", "photo_urls", "created_at",
]


def _incident_photo_urls(db: Session, incident_uuid: str, snapshot: Any) -> list:
    """Every Drive URL belonging to an incident, newest link last.

    `incidents.photo_urls` is only a snapshot of whatever the client had at the
    moment the incident was filed, and the normal flow is the other way round:
    file the incident, then get bounced to the Photos tab to attach photos to it.
    So the snapshot is usually empty or short. The authoritative link is
    `photos.incident_uuid` (see the model comment on Photo).

    Read the photos table, union it with the snapshot (so a URL captured offline
    and never re-uploaded is not lost), dedupe, and keep insertion order.
    """
    from app.db.models.photo import Photo  # local import to avoid a cycle

    urls: list = []
    seen: set = set()
    for u in snapshot or []:
        if isinstance(u, str) and u.strip() and u not in seen:
            seen.add(u)
            urls.append(u)
    try:
        rows = (
            db.query(Photo)
            .filter(Photo.incident_uuid == incident_uuid)
            .order_by(Photo.created_at.asc())
            .all()
        )
    except SQLAlchemyError:
        return urls  # DB blip: fall back to the snapshot rather than losing the row
    for p in rows:
        u = (p.drive_url or "").strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def export_incident_to_sheets(db: Session, inc: Dict[str, Any]) -> int:
    """Replace-style export: one row per incident_uuid on the Incidents tab, so
    admin edits (resolve, notes, cost) overwrite in place."""
    tab = os.getenv("SHEETS_INCIDENTS_TAB", "Incidents").strip() or "Incidents"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    uuid = inc.get("incident_uuid") or ""
    if not uuid:
        return 0

    svc = _get_sheets_svc(db)
    headers = _ensure_tab(svc, spreadsheet_id, tab, INCIDENT_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "incident_uuid", uuid)

    row = {
        "incident_uuid": uuid,
        "claim_number": inc.get("claim_number") or "",
        "incident_date": inc.get("incident_date") or "",
        "job_uuid": inc.get("job_uuid") or "",
        "job_name": inc.get("job_name") or "",
        "reported_by": inc.get("reported_by_name") or "",
        "attributed_crew": inc.get("attributed_crew") or "",
        "severity": inc.get("severity") or "",
        "attributable": inc.get("attributable") or "",
        "description": inc.get("description") or "",
        "est_cost": inc.get("est_cost") if inc.get("est_cost") is not None else "",
        "resolved": "Y" if inc.get("resolved") else "N",
        "notes": inc.get("notes") or "",
        "photo_urls": ", ".join(_incident_photo_urls(db, uuid, inc.get("photo_urls"))),
        "created_at": inc.get("created_at") or "",
    }
    _write_rows_top(svc, spreadsheet_id, tab, [_build_row(row, headers)])
    return 1


def _build_incident_payload(db: Session, incident_uuid: str) -> Optional[Dict[str, Any]]:
    """Re-read one incident from the DB into the export shape. The worker calls
    this when it runs, so a coalesced export always writes the latest committed
    state rather than a stale payload captured at request time."""
    from app.db.models.incident import Incident  # local import to avoid cycles

    inc = (
        db.query(Incident)
        .filter(Incident.incident_uuid == incident_uuid)
        .first()
    )
    if inc is None:
        return None
    try:
        photo_urls = json.loads(inc.photo_urls or "[]")
    except (ValueError, TypeError):
        photo_urls = []
    return {
        "incident_uuid": inc.incident_uuid,
        "claim_number": inc.claim_number,
        "incident_date": inc.incident_date,
        "job_uuid": inc.job_uuid,
        "job_name": inc.job_name,
        "reported_by_name": inc.reported_by_name,
        "attributed_crew": inc.attributed_crew,
        "severity": inc.severity,
        "attributable": inc.attributable,
        "description": inc.description,
        "est_cost": inc.est_cost,
        "resolved": inc.resolved,
        "notes": inc.notes,
        "photo_urls": photo_urls,
        "created_at": inc.created_at.isoformat() if inc.created_at else "",
    }


def _incident_export_worker(incident_uuid: str) -> None:
    from app.db.session import SessionLocal
    while True:
        db = SessionLocal()
        try:
            payload = _build_incident_payload(db, incident_uuid)
            if payload is not None:
                export_incident_to_sheets(db, payload)
            record_sheet_sync(db, "export_incident_to_sheets", True)
        except Exception as exc:
            print(f"[sheets] incident export failed ({incident_uuid}): {exc}")
            record_sheet_sync(db, "export_incident_to_sheets", False, str(exc))
        finally:
            try:
                db.close()
            except Exception:
                pass

        with _incident_export_lock:
            if incident_uuid in _incident_export_rerun:
                _incident_export_rerun.discard(incident_uuid)
                continue
            _incident_export_in_flight.discard(incident_uuid)
            return


def schedule_incident_export(incident_uuid: str) -> None:
    """Coalesce repeated exports for the same incident into one in-flight worker
    with at most one pending rerun.

    This MUST be used instead of firing export_incident_to_sheets directly.
    The export is replace-style (delete every row for this incident_uuid, then
    append one), and every photo tagged to an incident triggers another export so
    its photo_urls column stays current. Uploading a batch of photos therefore
    fires several exports at once; with two pool workers they interleave as
    A.delete, B.delete (finds nothing to delete), A.append, B.append, and the
    incident ends up in the admin's sheet TWICE. Coalescing collapses the burst
    into one write of the final state."""
    if not incident_uuid:
        return
    with _incident_export_lock:
        if incident_uuid in _incident_export_in_flight:
            _incident_export_rerun.add(incident_uuid)
            return
        _incident_export_in_flight.add(incident_uuid)
    _EXPORT_POOL.submit(_incident_export_worker, incident_uuid)


def _build_bol_payload(db: Session, bol_id: str) -> Optional[Dict[str, Any]]:
    """Re-read one BOL from the DB into the export shape export_bol_to_sheets
    expects. The worker calls this when it runs, so a coalesced export always
    writes the latest committed state. Signature blobs are deliberately NOT read
    - the sheet export never uses them, so keeping them out of the payload avoids
    pulling several base64 PNGs into memory per export."""
    from app.db.models.bol import DigitalBOL  # local import to avoid cycles

    row = db.query(DigitalBOL).filter(DigitalBOL.bol_id == bol_id).first()
    if row is None:
        return None
    try:
        items = json.loads(row.items_json or "[]")
    except (ValueError, TypeError):
        items = []
    try:
        shipment = json.loads(row.shipment_json) if row.shipment_json else {}
    except (ValueError, TypeError):
        shipment = {}
    return {
        "bol_id": row.bol_id,
        "created_by": row.created_by or "",
        "job_uuid": row.job_uuid or "",
        "job_name": row.job_name or "",
        "job_date": row.job_date or "",
        "status": row.status or "",
        "items": items,
        "shipment": shipment,
        "inventory_verified": (
            True if row.inventory_verified == 1
            else False if row.inventory_verified == 0
            else None
        ),
        "inventory_note": row.inventory_note or "",
        "origin_signed_at": row.origin_signed_at,
        "dest_signed_at": row.dest_signed_at,
        "final_charges": (
            float(row.final_charges) if row.final_charges is not None else None
        ),
        "walkthrough_notes": row.walkthrough_notes or "",
        "signed_pdf_url": row.signed_pdf_url or "",
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _bol_export_worker(bol_id: str) -> None:
    from app.db.session import SessionLocal
    while True:
        db = SessionLocal()
        try:
            payload = _build_bol_payload(db, bol_id)
            if payload is not None:
                export_bol_to_sheets(db, payload)
            record_sheet_sync(db, "export_bol_to_sheets", True)
        except Exception as exc:
            print(f"[sheets] bol export failed ({bol_id}): {exc}")
            record_sheet_sync(db, "export_bol_to_sheets", False, str(exc))
        finally:
            try:
                db.close()
            except Exception:
                pass

        with _bol_export_lock:
            if bol_id in _bol_export_rerun:
                _bol_export_rerun.discard(bol_id)
                continue
            _bol_export_in_flight.discard(bol_id)
            return


def schedule_bol_export(bol_id: str) -> None:
    """Coalesce repeated exports for the same BOL into one in-flight worker with
    at most one pending rerun.

    Use this instead of firing export_bol_to_sheets directly. The export is
    replace-style (delete every row for this bol_id across both tabs, then write
    fresh), and a single BOL is written repeatedly: the initial save, again per
    per-item photo link as it finishes uploading, again at origin signing, again
    at destination signing, again on PDF upload - and two crew share one BOL
    across devices. Firing an uncoalesced background export each time both lets
    two workers interleave delete/append into duplicate rows AND piles unbounded
    tasks onto the 2-worker pool. Coalescing collapses each burst into one write
    of the final state (same fix applied to incidents/inventory/availability)."""
    if not bol_id:
        return
    with _bol_export_lock:
        if bol_id in _bol_export_in_flight:
            _bol_export_rerun.add(bol_id)
            return
        _bol_export_in_flight.add(bol_id)
    _EXPORT_POOL.submit(_bol_export_worker, bol_id)


# ── Admin entry-status sweep ─────────────────────────────────────────────────
# When admin saves their initials + date on the Job Summary view, every row
# already exported for that job needs its trailing entered_by / entered_on
# cells populated. Future writes pick up the values via _entry_status_for; the
# sweep only fixes the historical rows.

def _sweep_sheet_entry_status(
    svc: Any,
    spreadsheet_id: str,
    tab: str,
    job_uuid: str,
    entered_by: str,
    entered_on: str,
) -> int:
    """Find every row on `tab` whose `job_uuid` cell matches and write
    (entered_by, entered_on) into its trailing entry-status columns.
    Returns rows updated. No-op if the sheet doesn't have the entry-status
    columns yet (next regular export will append them via _ensure_tab)."""
    hdr = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!1:1",
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0] if hdr else []
    if "job_uuid" not in headers_row or "entered_by" not in headers_row or "entered_on" not in headers_row:
        return 0

    job_uuid_idx = headers_row.index("job_uuid")
    entered_by_idx = headers_row.index("entered_by")
    entered_on_idx = headers_row.index("entered_on")

    job_uuid_letter = _col_letter(job_uuid_idx)
    col = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!{job_uuid_letter}:{job_uuid_letter}",
    ).execute())
    col_values = col.get("values") or []

    target_rows: List[int] = []
    for i, row in enumerate(col_values):
        if i == 0:
            continue  # header
        v = row[0] if row else ""
        if v == job_uuid:
            target_rows.append(i + 1)  # sheet rows are 1-based

    if not target_rows:
        return 0

    entered_by_letter = _col_letter(entered_by_idx)
    entered_on_letter = _col_letter(entered_on_idx)

    data: List[Dict[str, Any]] = []
    if entered_by_idx + 1 == entered_on_idx:
        # Adjacent columns - single contiguous range per row, half the API calls.
        for r in target_rows:
            data.append({
                "range": f"{tab}!{entered_by_letter}{r}:{entered_on_letter}{r}",
                "values": [[entered_by, entered_on]],
            })
    else:
        for r in target_rows:
            data.append({"range": f"{tab}!{entered_by_letter}{r}", "values": [[entered_by]]})
            data.append({"range": f"{tab}!{entered_on_letter}{r}", "values": [[entered_on]]})

    _api(lambda: svc.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute())
    return len(target_rows)


def update_entry_status_in_sheets(
    db: Session,
    job_uuid: str,
    entered_by: str,
    entered_on: str,
) -> Dict[str, int]:
    """Write the admin's data-entry checkpoint into every job-related
    worksheet for this job. Returns {tab: rows_updated} for diagnostics.
    Failures on individual tabs are swallowed and logged so a single
    transient Sheets hiccup can't take the whole sweep down."""
    if not job_uuid:
        return {}
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    svc = _get_sheets_svc(db)

    targets = [
        os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events",
        os.getenv("SHEETS_MATERIALS_TAB", DEFAULT_MATERIALS_TAB).strip() or DEFAULT_MATERIALS_TAB,
        os.getenv("SHEETS_JOB_REPORTS_TAB", "JobReports").strip() or "JobReports",
        os.getenv("SHEETS_BILLS_TAB", "Bills").strip() or "Bills",
    ]

    counts: Dict[str, int] = {}
    for tab in targets:
        try:
            counts[tab] = _sweep_sheet_entry_status(
                svc, spreadsheet_id, tab, job_uuid, entered_by, entered_on
            )
        except Exception as exc:
            counts[tab] = 0
            print(f"[entry-status sweep] {tab} failed for {job_uuid}: {exc}")
    return counts


# ── Office Hours ─────────────────────────────────────────────────────────────

OFFICE_HOURS_HEADERS = [
    "entry_uuid", "user_name", "work_date",
    "start_time", "end_time", "break_hours",
    "hours", "hours_rounded",
    "notes", "created_at", "updated_at",
]


def export_office_hours_to_sheets(db: Session, entry: Dict[str, Any]) -> int:
    """Replace-style export: exactly one row per entry_uuid in the
    OfficeHours tab. Each save re-appends so the sheet always reflects the
    current DB state, no stale duplicates from edits.

    Worksheet name read from SHEETS_OFFICE_HOURS_TAB so staging
    (OfficeHoursStaging) and prod (OfficeHours) land in distinct tabs
    inside the same spreadsheet - never hardcoded."""
    tab = os.getenv("SHEETS_OFFICE_HOURS_TAB", "OfficeHours").strip() or "OfficeHours"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    entry_uuid = entry.get("entry_uuid", "") or ""
    if not entry_uuid:
        return 0

    try:
        raw_hours = float(entry.get("hours") or 0)
    except (TypeError, ValueError):
        raw_hours = 0.0
    rounded = _round_billable_quarter(raw_hours)

    row = {
        "entry_uuid": entry_uuid,
        "user_name": entry.get("user_name", "") or "",
        "work_date": entry.get("work_date", "") or "",
        "start_time": entry.get("start_time", "") or "",
        "end_time": entry.get("end_time", "") or "",
        "break_hours": entry.get("break_hours", 0) or 0,
        "hours": raw_hours,
        "hours_rounded": rounded,
        "notes": entry.get("notes", "") or "",
        "created_at": _iso(entry.get("created_at")),
        "updated_at": _iso(entry.get("updated_at")),
    }

    svc = _get_sheets_svc(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, OFFICE_HOURS_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "entry_uuid", entry_uuid)
    rows = [_build_row(row, actual_headers)]

    def _append():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    _api(_append)
    return 1


# ── Reimbursements ───────────────────────────────────────────────────────────

REIMBURSEMENT_HEADERS = [
    "reimbursement_uuid", "user_name", "submitted_at", "type",
    "job_name", "job_date", "expense_date",
    "odometer_start", "odometer_end", "miles",
    "odometer_start_photo_url", "odometer_end_photo_url",
    "amount", "category", "vendor", "payment_method", "receipt_photo_url",
    "photos_link",
    "notes", "status", "approver", "approved_at", "approval_notes",
    "created_at", "updated_at",
]


def export_reimbursement_to_sheets(db: Session, entry: Dict[str, Any]) -> int:
    """Replace-style export: one row per reimbursement_uuid. Re-runs after
    an approve/reject overwrite in place. Worksheet name controlled by
    SHEETS_REIMBURSEMENTS_TAB so staging and prod land separately."""
    tab = os.getenv("SHEETS_REIMBURSEMENTS_TAB", "Reimbursements").strip() or "Reimbursements"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    reimbursement_uuid = entry.get("reimbursement_uuid", "") or ""
    if not reimbursement_uuid:
        return 0

    try:
        odo_start = entry.get("odometer_start")
        odo_end = entry.get("odometer_end")
        miles = ""
        if odo_start is not None and odo_end is not None:
            miles = max(0, int(odo_end) - int(odo_start))
    except (TypeError, ValueError):
        miles = ""

    row = {
        "reimbursement_uuid": reimbursement_uuid,
        "user_name": entry.get("user_name", "") or "",
        "submitted_at": _iso(entry.get("created_at")),
        "type": entry.get("type", "") or "",
        "job_name": entry.get("job_name", "") or "",
        "job_date": entry.get("job_date", "") or "",
        "expense_date": entry.get("expense_date", "") or "",
        "odometer_start": entry.get("odometer_start", "") if entry.get("odometer_start") is not None else "",
        "odometer_end": entry.get("odometer_end", "") if entry.get("odometer_end") is not None else "",
        "miles": miles,
        "odometer_start_photo_url": entry.get("odometer_start_photo_url", "") or "",
        "odometer_end_photo_url": entry.get("odometer_end_photo_url", "") or "",
        "amount": entry.get("amount", "") if entry.get("amount") is not None else "",
        "category": entry.get("category", "") or "",
        "vendor": entry.get("vendor", "") or "",
        "payment_method": entry.get("payment_method", "") or "",
        "receipt_photo_url": entry.get("receipt_photo_url", "") or "",
        "photos_link": entry.get("photos_drive_url", "") or "",
        "notes": entry.get("notes", "") or "",
        "status": entry.get("status", "") or "submitted",
        "approver": entry.get("approver_name", "") or "",
        "approved_at": _iso(entry.get("approved_at")),
        "approval_notes": entry.get("approval_notes", "") or "",
        "created_at": _iso(entry.get("created_at")),
        "updated_at": _iso(entry.get("updated_at")),
    }

    svc = _get_sheets_svc(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, REIMBURSEMENT_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "reimbursement_uuid", reimbursement_uuid)
    rows = [_build_row(row, actual_headers)]

    def _append():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    _api(_append)
    return 1


# ── Availability ─────────────────────────────────────────────────────────────

# 14 day-cells per window - each cell carries the date + status (+ optional
# note) inline so admins can read a window without cross-referencing column
# indexes back to a date. Window key (user_name + window_start) gates the
# replace-style upsert: re-submits overwrite the row in place.
AVAILABILITY_HEADERS = [
    "user_name", "window_start", "window_end",
    *[f"day_{i:02d}" for i in range(1, 15)],
    "updated_at", "user_email",
]


def _format_availability_cell(day: str, status: str, note: str) -> str:
    base = f"{day}: {status}"
    if note:
        return f"{base} - {note}"
    return base


def _sheet_numeric_id(svc: Any, spreadsheet_id: str, tab: str) -> Optional[int]:
    """Resolve a tab name to its numeric sheetId - required for
    deleteDimension batchUpdate requests."""
    sid = _sheet_ids(svc, spreadsheet_id).get(tab)
    if sid is None:
        sid = _sheet_ids(svc, spreadsheet_id, refresh=True).get(tab)
    return int(sid) if sid is not None else None


def export_availability_window_to_sheets(db: Session, entry: Dict[str, Any]) -> int:
    """One row per (user, window_start) in AvailabilityStaging / Availability.
    Re-submissions for the same window overwrite in place (delete-by-key,
    then append).

    Worksheet name controlled by SHEETS_AVAILABILITY_TAB so staging and prod
    land on separate tabs even though they share the same spreadsheet id.
    """
    tab = os.getenv("SHEETS_AVAILABILITY_TAB", "Availability").strip() or "Availability"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()

    user_name = (entry.get("user_name") or "").strip()
    window_start = (entry.get("window_start") or "").strip()
    days = entry.get("days") or []
    if not user_name or not window_start or not days:
        return 0

    # Build day_1..day_14 by index off window_start. The submission's `days`
    # list is keyed by date so we look up each window-day from there. Days
    # the crew didn't submit (gap in the window) render as blank.
    try:
        start_date = datetime.strptime(window_start, "%Y-%m-%d").date()
    except ValueError:
        return 0

    by_day: Dict[str, Dict[str, Any]] = {}
    latest_updated_at = None
    for d in days:
        day_key = (d.get("day") or "").strip()
        if not day_key:
            continue
        by_day[day_key] = d
        upd = d.get("updated_at")
        if upd and (latest_updated_at is None or upd > latest_updated_at):
            latest_updated_at = upd

    end_date = start_date.fromordinal(start_date.toordinal() + 13)
    user_email = (entry.get("user_email") or "").strip()
    row: Dict[str, Any] = {
        "user_name": user_name,
        "window_start": window_start,
        "window_end": end_date.isoformat(),
        "updated_at": _iso(latest_updated_at),
        "user_email": user_email,
    }
    for i in range(14):
        d = start_date.fromordinal(start_date.toordinal() + i)
        key = d.isoformat()
        entry_for_day = by_day.get(key)
        if entry_for_day:
            row[f"day_{i+1:02d}"] = _format_availability_cell(
                key,
                str(entry_for_day.get("status") or ""),
                str(entry_for_day.get("note") or ""),
            )
        else:
            row[f"day_{i+1:02d}"] = ""

    svc = _get_sheets_svc(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, AVAILABILITY_HEADERS)

    # Compound dedupe key - _delete_sheet_rows_by_value only takes one column
    # so we walk the values manually and delete rows that match both
    # user_name and window_start.
    try:
        user_col = actual_headers.index("user_name")
        win_col = actual_headers.index("window_start")
    except ValueError:
        user_col = win_col = None  # Tab malformed - skip delete, just append.

    if user_col is not None and win_col is not None:
        # Read ONLY the two key columns, not the whole tab. This tab grows one row
        # per (user, window) forever, and it used to read A:Z (all 26 columns x
        # every row) into memory on every export - a memory cost that grew without
        # bound. user_name/window_start are the only columns needed to find rows to
        # delete; reading just their span (A:B in practice) is ~13x lighter and the
        # absolute row indices are unchanged, so the delete stays correct.
        lo, hi = min(user_col, win_col), max(user_col, win_col)
        result = _api(
            lambda: svc.spreadsheets()
            .values()
            .get(
                spreadsheetId=spreadsheet_id,
                range=f"{tab}!{_col_letter(lo)}:{_col_letter(hi)}",
            )
            .execute()
        )
        values = result.get("values", []) or []
        u_at, w_at = user_col - lo, win_col - lo
        rows_to_delete: List[int] = []
        for idx, existing_row in enumerate(values):
            if idx == 0:
                continue  # header row
            if (
                len(existing_row) > max(u_at, w_at)
                and existing_row[u_at] == user_name
                and existing_row[w_at] == window_start
            ):
                rows_to_delete.append(idx)
        if rows_to_delete:
            sheet_numeric_id = _sheet_numeric_id(svc, spreadsheet_id, tab)
            if sheet_numeric_id is not None:
                # Delete bottom-up so earlier indexes don't shift mid-batch.
                requests = [
                    {
                        "deleteDimension": {
                            "range": {
                                "sheetId": sheet_numeric_id,
                                "dimension": "ROWS",
                                "startIndex": i,
                                "endIndex": i + 1,
                            }
                        }
                    }
                    for i in sorted(rows_to_delete, reverse=True)
                ]
                _api(
                    lambda: svc.spreadsheets()
                    .batchUpdate(
                        spreadsheetId=spreadsheet_id,
                        body={"requests": requests},
                    )
                    .execute()
                )

    rows_out = [_build_row(row, actual_headers)]

    def _append_avail():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows_out},
        ).execute()

    _api(_append_avail)
    return 1


def _build_availability_payload(db: Session, user_id: int, window_start: str):
    """Re-read one (user, window)'s availability from the DB into the export
    shape. The coalescing worker calls this when it runs, so a burst of edits
    collapses to a single write of the final committed state."""
    from app.db.models.availability import AvailabilityDay  # local import: avoid cycle
    from app.db.models.user import User

    rows = (
        db.query(AvailabilityDay)
        .filter(
            AvailabilityDay.user_id == user_id,
            AvailabilityDay.window_start == window_start,
        )
        .order_by(AvailabilityDay.day.asc())
        .all()
    )
    if not rows:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    name = (user.name if user else None) or (user.email if user else None) or ""
    return {
        "user_id": user_id,
        "user_name": name,
        "user_email": (user.email if user else "") or "",
        "window_start": window_start,
        "days": [
            {"day": r.day, "status": r.status, "note": r.note or "", "updated_at": r.updated_at}
            for r in rows
        ],
    }


def _availability_export_worker(key: str, user_id: int, window_start: str) -> None:
    from app.db.session import SessionLocal
    while True:
        db = SessionLocal()
        try:
            payload = _build_availability_payload(db, user_id, window_start)
            if payload is not None:
                export_availability_window_to_sheets(db, payload)
            record_sheet_sync(db, "export_availability_window_to_sheets", True)
        except Exception as exc:
            print(f"[sheets] availability export failed ({key}): {exc}")
            record_sheet_sync(db, "export_availability_window_to_sheets", False, str(exc))
        finally:
            try:
                db.close()
            except Exception:
                pass

        with _availability_export_lock:
            if key in _availability_export_rerun:
                _availability_export_rerun.discard(key)
                continue
            _availability_export_in_flight.discard(key)
            return


def schedule_availability_export(user_id: int, window_start: str) -> None:
    """Coalesce repeated availability exports for one (user, window) into a single
    in-flight worker with at most one pending rerun.

    This MUST be used instead of firing export_availability_window_to_sheets
    directly. The export is replace-style, and EACH does ~4 Google Sheets READ
    calls (two full-spreadsheet metadata gets, a header read, and a full-column
    read of a tab that grows forever). An admin editing a run of days fired one
    uncoalesced export per edit, which blew the 60-reads/min Sheets quota (429s),
    starved every other export, and piled unbounded tasks onto the 2-worker pool -
    a memory and rate-limit problem at once. Coalescing collapses a burst for one
    (user, window) into a single write of the final state. The other high-frequency
    exports (incidents, inventory, estimates) were already coalesced; this one was
    the gap."""
    if user_id is None or not window_start:
        return
    key = f"{user_id}::{window_start}"
    with _availability_export_lock:
        if key in _availability_export_in_flight:
            _availability_export_rerun.add(key)
            return
        _availability_export_in_flight.add(key)
    _EXPORT_POOL.submit(_availability_export_worker, key, user_id, window_start)


# ── Sheets sync health check ─────────────────────────────────────────────────
# One entry per app->sheet sync. The Advanced Settings system check iterates this
# registry, so when a new feature adds a sync, add its entry here and it's
# automatically covered by the health check (and the /vet protocol). `fn` is the
# export function name used to look up last-run status (several syncs can share a
# function, e.g. a summary + its item rows).
SHEET_SYNC_REGISTRY = [
    {"key": "events",            "label": "Timeline events",     "env": "SHEETS_EVENTS_TAB",             "default": "Events",            "fn": "export_events_to_sheets"},
    {"key": "materials",         "label": "Materials",           "env": "SHEETS_MATERIALS_TAB",          "default": "Materials",         "fn": "export_materials_to_sheets"},
    {"key": "job_reports",       "label": "Job reports",         "env": "SHEETS_JOB_REPORTS_TAB",        "default": "JobReports",        "fn": "export_job_report_to_sheets"},
    {"key": "bills",             "label": "Bills / invoices",    "env": "SHEETS_BILLS_TAB",              "default": "Bills",             "fn": "export_bill_to_sheets"},
    {"key": "estimates",         "label": "Estimates",           "env": "SHEETS_ESTIMATES_TAB",          "default": "Estimates",         "fn": "export_estimate_to_sheets"},
    {"key": "estimate_items",    "label": "Estimate items",      "env": "SHEETS_ESTIMATE_ITEMS_TAB",     "default": "EstimateItems",     "fn": "export_estimate_to_sheets"},
    {"key": "bols",              "label": "Bills of lading",     "env": "SHEETS_BOLS_TAB",               "default": "BOLs",              "fn": "export_bol_to_sheets"},
    {"key": "bol_items",         "label": "BOL items",           "env": "SHEETS_BOL_ITEMS_TAB",          "default": "BOLItems",          "fn": "export_bol_to_sheets"},
    {"key": "job_inventory",     "label": "Job inventory",       "env": "SHEETS_JOB_INVENTORY_TAB",      "default": "JobInventory",      "fn": "export_job_inventory_to_sheets"},
    {"key": "job_inventory_items","label": "Job inventory items","env": "SHEETS_JOB_INVENTORY_ITEMS_TAB","default": "JobInventoryItems", "fn": "export_job_inventory_to_sheets"},
    {"key": "incidents",         "label": "Incidents",           "env": "SHEETS_INCIDENTS_TAB",          "default": "Incidents",         "fn": "export_incident_to_sheets"},
    {"key": "dvirs",             "label": "DVIRs",               "env": "SHEETS_DVIRS_TAB",              "default": "DVIRs",             "fn": "export_dvir_to_sheets"},
    {"key": "prior_hours",       "label": "Prior on-duty (PODS)","env": "SHEETS_PRIOR_HOURS_TAB",        "default": "PriorOnDuty",       "fn": "export_prior_hours_to_sheets"},
    {"key": "rods",             "label": "RODS logs",            "env": "SHEETS_RODS_TAB",               "default": "RODS",              "fn": "export_rods_to_sheets"},
    {"key": "ld_pay",            "label": "Long-distance pay",   "env": "SHEETS_LD_PAY_TAB",             "default": "LongDistancePay",   "fn": "export_ld_day_to_sheets"},
    {"key": "office_hours",      "label": "Office hours",        "env": "SHEETS_OFFICE_HOURS_TAB",       "default": "OfficeHours",       "fn": "export_office_hours_to_sheets"},
    {"key": "reimbursements",    "label": "Reimbursements",      "env": "SHEETS_REIMBURSEMENTS_TAB",     "default": "Reimbursements",    "fn": "export_reimbursement_to_sheets"},
    {"key": "availability",      "label": "Availability",        "env": "SHEETS_AVAILABILITY_TAB",       "default": "Availability",      "fn": "export_availability_window_to_sheets"},
    {"key": "off_job_hours",     "label": "Off-job hours",       "env": "SHEETS_OFF_JOB_TAB",            "default": "OffJobHours",       "fn": "export_off_job_to_sheets"},
]


def check_sheets_sync(db: Session) -> Dict[str, Any]:
    """Health check for every app->sheet sync. Verifies the Sheets connection,
    then per registered sync: whether its tab exists in the spreadsheet, whether
    its tab env var is explicitly set (unset = using the default, which on
    staging silently targets the prod tab), and the last success/failure time.

    Reports *current* state, not history. `failing` is true only when the last
    attempt failed - a sync that hit a transient 429 last week and has synced
    fine since is healthy, and saying otherwise trains admins to ignore the
    panel. `never_synced` separates "tab isn't there because nothing has ever
    used this feature" (normal; `_ensure_tab` creates it on first write) from
    "tab is gone but this sync has data" (a real problem).

    Returns a JSON-able dict for the Advanced Settings system check. New syncs
    are covered automatically by adding to SHEET_SYNC_REGISTRY."""
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    result: Dict[str, Any] = {
        "spreadsheet_id": spreadsheet_id,
        "connected": False,
        "error": None,
        "syncs": [],
    }

    try:
        svc = _get_sheets_svc(db)
        meta = _api(lambda: svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute())
        titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
        result["connected"] = True
    except Exception as e:  # noqa: BLE001 - surface the failure to the admin
        result["error"] = str(e)
        return result

    try:
        from app.db.models.sheet_sync_status import SheetSyncStatus
        statuses = {r.fn_name: r for r in db.query(SheetSyncStatus).all()}
    except Exception:
        statuses = {}

    for entry in SHEET_SYNC_REGISTRY:
        raw = (os.getenv(entry["env"]) or "").strip()
        tab = raw or entry["default"]
        st = statuses.get(entry.get("fn") or "")
        ok_at = st.last_ok_at if st else None
        err_at = st.last_error_at if st else None
        # Failing = the most recent attempt failed. An error older than the last
        # success has already been recovered from.
        failing = bool(err_at) and (ok_at is None or err_at > ok_at)
        never_synced = ok_at is None and err_at is None
        tab_exists = tab in titles
        result["syncs"].append({
            "key": entry["key"],
            "label": entry["label"],
            "tab": tab,
            "env_var": entry["env"],
            "env_set": bool(raw),
            "tab_exists": tab_exists,
            "never_synced": never_synced,
            "failing": failing,
            # A missing tab only matters once something has tried to write to it.
            "needs_attention": failing or (not tab_exists and not never_synced),
            "last_ok_at": ok_at.isoformat() if ok_at else None,
            "last_error_at": err_at.isoformat() if err_at else None,
            "last_error": (st.last_error if st else None),
        })

    result["ok"] = not any(s["needs_attention"] for s in result["syncs"])
    return result


# ── Off-job hours export ─────────────────────────────────────────────────────

OFF_JOB_HEADERS = [
    "entry_uuid", "submitted_by", "work_date", "start_time", "end_time",
    "hours", "pay_structure", "pay_other_note", "notes", "created_at",
]


def export_off_job_to_sheets(db: Session, entry: Dict[str, Any]) -> int:
    """Replace-style export: one row per entry_uuid on the OffJobHours tab, so a
    re-submit (offline retry) overwrites in place rather than duplicating."""
    tab = os.getenv("SHEETS_OFF_JOB_TAB", "OffJobHours").strip() or "OffJobHours"
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    uuid = entry.get("entry_uuid") or ""
    if not uuid:
        return 0

    svc = _get_sheets_svc(db)
    headers = _ensure_tab(svc, spreadsheet_id, tab, OFF_JOB_HEADERS)
    _delete_sheet_rows_by_value(svc, spreadsheet_id, tab, "entry_uuid", uuid)

    row = {
        "entry_uuid": uuid,
        "submitted_by": entry.get("submitted_by_name") or "",
        "work_date": entry.get("work_date") or "",
        "start_time": entry.get("start_time") or "",
        "end_time": entry.get("end_time") or "",
        "hours": entry.get("hours") if entry.get("hours") is not None else "",
        "pay_structure": entry.get("pay_structure") or "",
        "pay_other_note": entry.get("pay_other_note") or "",
        "notes": entry.get("notes") or "",
        "created_at": entry.get("created_at") or "",
    }
    _write_rows_top(svc, spreadsheet_id, tab, [_build_row(row, headers)])
    return 1
