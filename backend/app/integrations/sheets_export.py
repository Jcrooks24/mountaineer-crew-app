import os
from typing import List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import text

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

# Reuse your existing OAuth token.json flow (already has sheets scope now)
from app.core.google_cal_oauth import SCOPES

DEFAULT_SHEET_ID = "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs"


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

    # 3) Append to Sheets
    creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

    # 4) Mark exported (dedupe) in SQLite
    # Use INSERT OR IGNORE to be extra safe.
    for ev in new_events:
        db.execute(
            text("INSERT OR IGNORE INTO sheet_event_exports(event_id) VALUES (:event_id)"),
            {"event_id": str(ev["event_id"])},
        )
    db.commit()

    return len(rows)
