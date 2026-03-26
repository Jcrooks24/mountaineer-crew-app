import os
from typing import List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import text

from googleapiclient.discovery import build
from app.core.google_cal_oauth import _get_creds

DEFAULT_SHEET_ID = "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs"
DEFAULT_MATERIALS_TAB = "Materials"

EVENTS_HEADERS = [
    "event_id", "timestamp", "job_uuid", "job_name", "job_date",
    "type", "note", "lat", "lng", "accuracy_m", "device_id", "synced",
]
MATERIALS_HEADERS = [
    "submission_id", "created_at", "job_uuid", "job_name", "job_date",
    "notes", "item_name", "qty", "unit_price", "line_total", "submission_total",
]


def _ensure_tab(svc: Any, spreadsheet_id: str, tab: str, headers: List[str]) -> None:
    """Create the sheet tab with a header row if it doesn't already exist."""
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = [s["properties"]["title"] for s in meta.get("sheets", [])]
    if tab not in existing:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute()
        svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="RAW",
            body={"values": [headers]},
        ).execute()


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

    # 1) Filter out already-exported event_ids
    new_events: List[Dict[str, Any]] = []
    for ev in events:
        event_id = str(ev["event_id"])
        exists = db.execute(
            text("SELECT 1 FROM sheet_event_exports WHERE event_id = :event_id LIMIT 1"),
            {"event_id": event_id},
        ).fetchone()
        if not exists:
            new_events.append(ev)

    if not new_events:
        return 0

    # 2) Build rows to append (must match your Events tab headers)
    rows: List[List[Any]] = []
    for ev in new_events:
        rows.append([
            ev["event_id"],
            ev["timestamp"],                # ISO string
            ev["job_uuid"],
            ev.get("job_name", ""),         # blank for now (frontend localStorage only)
            ev.get("job_date", ""),         # blank for now
            ev["type"],
            ev.get("note") or "",
            ev.get("lat"),
            ev.get("lng"),
            ev.get("accuracy_m"),
            ev.get("device_id") or "",
            "synced",
        ])

    # 3) Get credentials from DB / env var (works on Render, no local file needed)
    creds = _get_creds(db)
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    _ensure_tab(svc, spreadsheet_id, tab, EVENTS_HEADERS)

    svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

    # 4) Mark exported (dedupe) — PostgreSQL-compatible ON CONFLICT syntax
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
    job_uuid = submission.get("job_uuid", "")
    job_name = submission.get("jobName", "")
    job_date = submission.get("jobDate", "")
    created_at = submission.get("created_at", "")
    notes = submission.get("notes", "")
    total = submission.get("total", 0)

    rows: List[List[Any]] = []
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

        rows.append([
            submission_id,
            created_at,
            job_uuid,
            job_name,
            job_date,
            notes,
            item.get("name", ""),
            qty,
            unit_price if unit_price is not None else "",
            line_total,
            total,
        ])

    if not rows:
        return 0

    creds = _get_creds(db)
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    _ensure_tab(svc, spreadsheet_id, tab, MATERIALS_HEADERS)

    svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

    # Mark exported for deduplication
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

    return len(rows)
