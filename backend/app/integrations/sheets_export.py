import os
from typing import List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.google_cal_oauth import get_sheets_service, _build_authorized_http, _ssl_retry, _get_creds

DEFAULT_SHEET_ID = "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs"
DEFAULT_MATERIALS_TAB = "Materials"

EVENTS_HEADERS = [
    "event_id", "timestamp", "job_uuid", "job_name", "job_date",
    "type", "note", "lat", "lng", "accuracy_m", "device_id", "created_by", "synced",
]
MATERIALS_HEADERS = [
    "submission_id", "created_at", "job_uuid", "job_name", "job_date", "job_label",
    "notes", "item_name", "qty", "unit_price", "line_total", "submission_total",
]


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
    svc = get_sheets_service(db)
    actual_headers = _ensure_tab(svc, spreadsheet_id, tab, EVENTS_HEADERS)

    # 3) Build rows keyed by column name so order always matches the sheet
    rows: List[List[Any]] = []
    for ev in new_events:
        row_data: Dict[str, Any] = {
            "event_id":   ev["event_id"],
            "timestamp":  ev["timestamp"],
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
        }
        rows.append(_build_row(row_data, actual_headers))

    # 4) Append rows
    def _append():
        authorized_http = _build_authorized_http(_get_creds(db))
        from googleapiclient.discovery import build
        svc_fresh = build("sheets", "v4", http=authorized_http, cache_discovery=False)
        svc_fresh.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    _ssl_retry(_append)

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
            "line_total":       line_total,
            "submission_total": total,
        })

    if not new_rows:
        return 0

    # 2) Build service ONCE with certifi CA bundle (avoids SSL errors on Render).
    #    Reuse it for both _ensure_tab and append to avoid double discovery-doc download.
    from googleapiclient.discovery import build as _build
    authorized_http = _build_authorized_http(_get_creds(db))
    svc = _build("sheets", "v4", http=authorized_http, cache_discovery=False)

    actual_headers = _ssl_retry(lambda: _ensure_tab(svc, spreadsheet_id, tab, MATERIALS_HEADERS))
    rows = [_build_row(r, actual_headers) for r in new_rows]

    def _append():
        svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    _ssl_retry(_append)

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
