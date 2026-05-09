import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable, List, Dict, Any, Optional, Set

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.google_cal_oauth import _build_authorized_http, _ssl_retry, _get_creds

# Bounded pool — at most 2 export threads run concurrently. Additional tasks
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
# socket — no cross-thread SSL races.
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

# Serialize note-cell updates per event_id so rapid edits on the same event
# (or client retries) can't stack multiple in-memory googleapiclient instances
# in the pool queue. One lock bucket per event_id is short-lived and cheap.
_event_note_locks: Dict[str, threading.Lock] = {}
_event_note_locks_guard = threading.Lock()

# Mirror dict for editable-timestamp cell updates. Kept separate from the
# note locks so a timestamp edit and a note edit on the same event don't
# block each other — they target different cells in the same sheet row.
_event_timestamp_locks: Dict[str, threading.Lock] = {}
_event_timestamp_locks_guard = threading.Lock()


def _lock_for_event_note(event_id: str) -> threading.Lock:
    with _event_note_locks_guard:
        lock = _event_note_locks.get(event_id)
        if lock is None:
            lock = threading.Lock()
            _event_note_locks[event_id] = lock
        return lock


def _lock_for_event_timestamp(event_id: str) -> threading.Lock:
    with _event_timestamp_locks_guard:
        lock = _event_timestamp_locks.get(event_id)
        if lock is None:
            lock = threading.Lock()
            _event_timestamp_locks[event_id] = lock
        return lock


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
        except Exception as exc:
            print(f"[sheets] background export failed ({export_fn.__name__}): {exc}")
        finally:
            try:
                db.close()
            except Exception:
                pass

    _EXPORT_POOL.submit(_worker)

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


def _ensure_tab(svc: Any, spreadsheet_id: str, tab: str, headers: List[str]) -> List[str]:
    """
    Ensure the sheet tab exists and contains all expected header columns.

    - If the tab does not exist: create it and write the full header row.
    - If the tab exists: read the current header row; append any columns that
      are missing (new fields added over time) to the right of the existing ones.

    Returns the final ordered list of headers as they appear in the sheet
    (existing columns first, any newly-added columns at the end).
    """
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing_tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]

    if tab not in existing_tabs:
        # Create the tab
        svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute()
        # Write full header row
        svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            body={"values": [headers]},
        ).execute()
        return list(headers)

    # Tab exists — read current header row
    result = svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!1:1",
    ).execute()
    current = result.get("values", [[]])[0] if result.get("values") else []

    # Find any columns we want but that aren't in the sheet yet
    missing = [h for h in headers if h not in current]
    if missing:
        start_letter = _col_letter(len(current))
        svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{start_letter}1",
            valueInputOption="RAW",
            body={"values": [missing]},
        ).execute()
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
    recent activity at the top — what admins actually want when they open
    the sheet looking for what just happened.

    Late arrivals from the reconciler land at the top regardless of their
    actual chronology; the Apps Script cleanup re-sorts strictly when
    order drifts.

    No-op for empty `rows`. Falls back to plain append if the tab can't
    be found in metadata (defensive — _ensure_tab should have created it).
    """
    if not rows:
        return

    meta = _ssl_retry(lambda: svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute())
    sheet_numeric_id: Optional[int] = None
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == tab:
            sheet_numeric_id = s["properties"]["sheetId"]
            break
    if sheet_numeric_id is None:
        _ssl_retry(lambda: svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute())
        return

    n = len(rows)
    _ssl_retry(lambda: svc.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": [{
            "insertDimension": {
                "range": {
                    "sheetId": sheet_numeric_id,
                    "dimension": "ROWS",
                    "startIndex": 1,        # row 2 (0-based) — directly below header
                    "endIndex": 1 + n,
                },
                # Don't pull header formatting (bold, frozen, etc.) onto the
                # data rows we're about to write.
                "inheritFromBefore": False,
            }
        }]},
    ).execute())

    width = max((len(r) for r in rows), default=0)
    if width <= 0:
        return
    end_col = _col_letter(width - 1)
    _ssl_retry(lambda: svc.spreadsheets().values().update(
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
        text("SELECT event_id FROM sheet_event_exports WHERE event_id IN :ids"),
        {"ids": tuple(all_ids)},
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

    # 4) Insert at top — newest activity above older rows
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

    actual_headers = _ssl_retry(lambda: _ensure_tab(svc, spreadsheet_id, tab, MATERIALS_HEADERS))
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
    handling this event — the queued retry will catch the latest value.
    """
    if not event_id:
        return 0

    lock = _lock_for_event_note(event_id)
    if not lock.acquire(blocking=False):
        # Another worker is already syncing this event_id — skip. The client's
        # patch queue will re-issue the latest value if this call failed to
        # land.
        return 0

    try:
        spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
        tab = os.getenv("SHEETS_EVENTS_TAB", "Events").strip() or "Events"

        svc = _get_sheets_svc(db)
        hdr = _ssl_retry(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute())
        headers_row = (hdr.get("values") or [[]])[0]
        if "event_id" not in headers_row or "note" not in headers_row:
            return 0

        event_col_letter = _col_letter(headers_row.index("event_id"))
        note_col_letter = _col_letter(headers_row.index("note"))

        col = _ssl_retry(lambda: svc.spreadsheets().values().get(
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

        _ssl_retry(lambda: svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!{note_col_letter}{target_row}",
            valueInputOption="RAW",
            body={"values": [[note or ""]]},
        ).execute())
        return 1
    finally:
        lock.release()


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
        hdr = _ssl_retry(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute())
        headers_row = (hdr.get("values") or [[]])[0]
        if "event_id" not in headers_row or "timestamp" not in headers_row:
            return 0

        event_col_letter = _col_letter(headers_row.index("event_id"))
        ts_col_letter = _col_letter(headers_row.index("timestamp"))

        col = _ssl_retry(lambda: svc.spreadsheets().values().get(
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

        _ssl_retry(lambda: svc.spreadsheets().values().update(
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
    crew member removed a material from a job — admins reading the sheet for
    cost analysis would see items that no longer exist in the app.
    """
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    tab = os.getenv("SHEETS_MATERIALS_TAB", DEFAULT_MATERIALS_TAB).strip() or DEFAULT_MATERIALS_TAB

    svc = _get_sheets_svc(db)

    # Resolve the numeric sheetId for deleteDimension
    meta = _ssl_retry(lambda: svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute())
    props = next(
        (s["properties"] for s in meta.get("sheets", []) if s["properties"]["title"] == tab),
        None,
    )
    if not props:
        return 0
    sheet_numeric_id = props["sheetId"]

    # Locate the submission_id column
    hdr = _ssl_retry(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!1:1",
    ).execute())
    headers_row = (hdr.get("values") or [[]])[0]
    if "submission_id" not in headers_row:
        return 0
    col_letter = _col_letter(headers_row.index("submission_id"))

    # Pull just that column to find matching row indices
    col = _ssl_retry(lambda: svc.spreadsheets().values().get(
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
        _ssl_retry(lambda: svc.spreadsheets().batchUpdate(
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

    actual_headers = _ssl_retry(lambda: _ensure_tab(svc, spreadsheet_id, tab, headers))
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
    "dumpster_pct", "recycling_pct", "billing_method",
    "review_candidate", "hours_match", "hours_mismatch_reason",
    "employee_hours", "created_at", "updated_at",
    "entered_by", "entered_on",
]


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

    Per-row figures stay as the *actual* worked hours — the company's
    quarter-hour rounding is applied once at the end, to the summed total,
    not to individual entries. Non-billable rows show as such and are
    excluded from the total.
    """
    if not entries:
        return ""
    lines: list[str] = []
    total_actual = 0.0
    for e in entries:
        if not isinstance(e, dict):
            continue
        name = (e.get("name") or "").strip() or "—"
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
        span = f"{start}–{end}" if start and end else (start or end or "")
        pieces = [name + ":"]
        if span:
            pieces.append(span + ("," if br > 0 else ""))
        if br > 0:
            pieces.append(f"break {br:.2f}h")
        if non_billable:
            pieces.append(f"→ non-billable (actual {hrs:.2f}h)")
        else:
            pieces.append(f"→ {hrs:.2f}h")
        lines.append(" ".join(pieces))
    if lines:
        total_billable = _round_billable_quarter(total_actual)
        if abs(total_billable - total_actual) > 0.001:
            lines.append(
                f"Total man-hours: {total_billable:.2f}h (actual {total_actual:.2f}h)"
            )
        else:
            lines.append(f"Total man-hours: {total_billable:.2f}h")
    return "\n".join(lines)


def export_job_report_to_sheets(db: Session, report: Dict[str, Any]) -> int:
    tab = os.getenv("SHEETS_JOB_REPORTS_TAB", "JobReports").strip() or "JobReports"
    key = f'{report.get("job_uuid","")}:{_iso(report.get("updated_at"))}'
    if _generic_already_exported(db, "job_report", key):
        return 0
    entered_by, entered_on = _entry_status_for(db, report.get("job_uuid", "") or "")
    row = {
        "job_uuid": report.get("job_uuid", ""),
        "job_name": report.get("job_name", ""),
        "submitted_by": report.get("submitted_by_name", "") or "",
        "personal_vehicles": report.get("personal_vehicles", ""),
        "dumpster_pct": report.get("dumpster_pct", ""),
        "recycling_pct": report.get("recycling_pct", ""),
        "billing_method": report.get("billing_method", ""),
        "review_candidate": _review_candidate_label(report.get("review_candidate")),
        "hours_match": "Yes" if report.get("hours_match") else "No",
        "hours_mismatch_reason": report.get("hours_mismatch_reason", "") or "",
        "employee_hours": _format_employee_hours(report.get("employee_hours")),
        "created_at": _iso(report.get("created_at")),
        "updated_at": _iso(report.get("updated_at")),
        "entered_by": entered_by,
        "entered_on": entered_on,
    }
    written = _append_rows(db, tab, JOB_REPORT_HEADERS, [row])
    if written:
        _generic_mark_exported(db, "job_report", [key])
    return written


# ── Bills ────────────────────────────────────────────────────────────────────

BILL_HEADERS = [
    "job_uuid", "saved_by", "item_label", "item_qty", "item_unit", "item_rate",
    "item_discount_pct", "item_amount", "item_source",
    "global_discount_pct", "bill_notes", "updated_at",
    "entered_by", "entered_on",
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
        })
        keys.append(key)

    written = _append_rows(db, tab, BILL_HEADERS, rows)
    if written:
        _generic_mark_exported(db, "bill", keys)
    return written


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
    key = rods.get("rods_id", "")
    if not key or _generic_already_exported(db, "rods", key):
        return 0

    changes = rods.get("duty_changes") or []
    duty_str = " | ".join(
        f"{c.get('time','')} {c.get('status','')}"
        + (f" @ {c.get('location','')}" if c.get("location") else "")
        + (f" — {c.get('remarks','')}" if c.get("remarks") else "")
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
    written = _append_rows(db, tab, RODS_HEADERS, [row])
    if written:
        _generic_mark_exported(db, "rods", [key])
    return written


# ── Estimates ────────────────────────────────────────────────────────────────

ESTIMATE_HEADERS = [
    "estimate_uuid", "created_by", "customer_name", "customer_email",
    "customer_phone", "move_date", "origin_address", "destination_address",
    "origin_access_notes", "destination_access_notes",
    "special_items_notes", "general_notes",
    "estimated_weight_lbs", "estimated_cubic_ft", "item_count",
    "created_at", "updated_at",
]

ESTIMATE_ITEM_HEADERS = [
    "estimate_uuid", "customer_name", "item_id", "room", "subcategory",
    "item_name", "qty", "weight_lbs_each", "cubic_ft_each",
    "total_weight_lbs", "total_cubic_ft", "notes", "exported_at",
]


def _delete_estimate_sheet_rows(
    svc: Any,
    spreadsheet_id: str,
    tabs: List[str],
    estimate_uuid: str,
) -> None:
    """Delete all rows for `estimate_uuid` from each tab. col_name is always
    'estimate_uuid' in both Estimates and EstimateItems tabs."""
    meta = _ssl_retry(lambda: svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute())
    sheet_ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}

    for tab in tabs:
        if tab not in sheet_ids:
            continue
        sheet_numeric_id = sheet_ids[tab]

        hdr = _ssl_retry(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"{tab}!1:1"
        ).execute())
        headers_row = (hdr.get("values") or [[]])[0]
        if "estimate_uuid" not in headers_row:
            continue
        col_letter = _col_letter(headers_row.index("estimate_uuid"))

        col = _ssl_retry(lambda: svc.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"{tab}!{col_letter}:{col_letter}"
        ).execute())
        col_values = col.get("values") or []

        target_indices = [
            i for i, row in enumerate(col_values)
            if i > 0 and (row[0] if row else "") == estimate_uuid
        ]

        if target_indices:
            requests = [
                {"deleteDimension": {"range": {
                    "sheetId": sheet_numeric_id,
                    "dimension": "ROWS",
                    "startIndex": idx,
                    "endIndex": idx + 1,
                }}}
                for idx in sorted(target_indices, reverse=True)
            ]
            _ssl_retry(lambda: svc.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id, body={"requests": requests}
            ).execute())


def export_estimate_to_sheets(db: Session, estimate: Dict[str, Any]) -> int:
    """Writes one summary row to Estimates and one row per item to EstimateItems,
    always reflecting the current state of the estimate (replace strategy —
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
        "estimated_weight_lbs": round(estimate.get("estimated_weight_lbs", 0) or 0, 2),
        "estimated_cubic_ft": round(estimate.get("estimated_cubic_ft", 0) or 0, 2),
        "item_count": sum(it.get("qty", 1) or 1 for it in items),
        "created_at": _iso(estimate.get("created_at")),
        "updated_at": updated_at,
    }
    actual_summary_headers = _ssl_retry(lambda: _ensure_tab(svc, spreadsheet_id, summary_tab, ESTIMATE_HEADERS))
    rows = [_build_row(summary_row, actual_summary_headers)]

    _write_rows_top(svc, spreadsheet_id, summary_tab, rows)
    _generic_mark_exported(db, "estimate", [summary_key])
    total_written += 1

    # Item rows — one per current item
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

        actual_item_headers = _ssl_retry(lambda: _ensure_tab(svc, spreadsheet_id, items_tab, ESTIMATE_ITEM_HEADERS))
        item_sheet_rows = [_build_row(r, actual_item_headers) for r in item_rows]

        _write_rows_top(svc, spreadsheet_id, items_tab, item_sheet_rows)
        _generic_mark_exported(db, "estimate_item", item_keys)
        total_written += len(item_rows)

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


def _estimate_export_worker(estimate_uuid: str) -> None:
    from app.db.session import SessionLocal
    # Loop until no rerun flag was set while the previous export was running.
    # Bounds queue growth: at most one in-flight export + one pending rerun
    # marker per estimate_uuid, regardless of how many PATCHes stream in.
    while True:
        db = SessionLocal()
        try:
            payload = _build_estimate_payload(db, estimate_uuid)
            if payload is not None:
                export_estimate_to_sheets(db, payload)
        except Exception as exc:
            print(f"[sheets] estimate export failed ({estimate_uuid}): {exc}")
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
    autosave keystroke — the worker re-reads the DB when it runs so the
    final export always reflects the latest committed state."""
    if not estimate_uuid:
        return
    with _estimate_export_lock:
        if estimate_uuid in _estimate_export_in_flight:
            _estimate_export_rerun.add(estimate_uuid)
            return
        _estimate_export_in_flight.add(estimate_uuid)
    _EXPORT_POOL.submit(_estimate_export_worker, estimate_uuid)


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
    hdr = _ssl_retry(lambda: svc.spreadsheets().values().get(
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
    col = _ssl_retry(lambda: svc.spreadsheets().values().get(
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
        # Adjacent columns — single contiguous range per row, half the API calls.
        for r in target_rows:
            data.append({
                "range": f"{tab}!{entered_by_letter}{r}:{entered_on_letter}{r}",
                "values": [[entered_by, entered_on]],
            })
    else:
        for r in target_rows:
            data.append({"range": f"{tab}!{entered_by_letter}{r}", "values": [[entered_by]]})
            data.append({"range": f"{tab}!{entered_on_letter}{r}", "values": [[entered_on]]})

    _ssl_retry(lambda: svc.spreadsheets().values().batchUpdate(
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
