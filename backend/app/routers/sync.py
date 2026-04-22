import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel

from app.db.session import get_db
from app.db.models.event import Event
from app.db.models.calendar_job import CalendarJob
from app.integrations.sheets_export import (
    export_events_to_sheets,
    update_event_note_in_sheets,
)
from app.core.deps import get_current_user
from app.db.models.user import User


router = APIRouter(prefix="/api", tags=["sync"])


class EventIn(BaseModel):
    event_id: str
    job_uuid: str
    job_id: Optional[int] = None
    type: str
    timestamp: str  # ISO string from device
    lat: Optional[float] = None
    lng: Optional[float] = None
    accuracy_m: Optional[float] = None
    note: Optional[str] = None
    job_name: Optional[str] = None
    job_date: Optional[str] = None
    created_by: Optional[str] = None


class SyncIn(BaseModel):
    device_id: Optional[str] = None
    events: List[EventIn]


@router.post("/sync")
def sync(payload: SyncIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inserted = 0
    duplicates = 0
    errors = 0
    failed = []

    inserted_events_for_sheet = []  # collect inserted events for sheets export

    for e in payload.events:
        try:
            ts = datetime.fromisoformat(e.timestamp.replace("Z", "+00:00"))
        except Exception:
            errors += 1
            failed.append({
                "event_id": e.event_id,
                "reason": "bad_timestamp",
                "timestamp": e.timestamp,
            })
            continue

        row = Event(
            event_id=e.event_id,
            job_uuid=e.job_uuid,
            job_id=e.job_id,
            type=e.type,
            timestamp=ts,
            lat=e.lat,
            lng=e.lng,
            accuracy_m=e.accuracy_m,
            note=e.note,
            job_name=e.job_name or None,
            created_by=e.created_by or None,
            synced=True,
        )

        db.add(row)

        try:
            db.commit()
            inserted += 1

            # Collect for sheets export (use original ISO string)
            inserted_events_for_sheet.append({
                "event_id": e.event_id,
                "timestamp": e.timestamp,
                "job_uuid": e.job_uuid,
                "job_name": e.job_name or "",
                "job_date": e.job_date or "",
                "type": e.type,
                "note": e.note,
                "lat": e.lat,
                "lng": e.lng,
                "accuracy_m": e.accuracy_m,
                "device_id": payload.device_id or "",
                "created_by": e.created_by or "",
            })

        except IntegrityError:
            db.rollback()
            duplicates += 1
        except Exception:
            db.rollback()
            errors += 1
            failed.append({
                "event_id": e.event_id,
                "reason": "db_error",
            })

    # Export to Sheets (non-blocking)
    sheets_exported = 0
    sheets_error = None
    try:
        sheets_exported = export_events_to_sheets(db, inserted_events_for_sheet)
    except Exception as ex:
        # Do not break sync for crews
        sheets_error = str(ex)

    return {
        "ok": True,
        "inserted": inserted,
        "duplicates": duplicates,
        "errors": errors,
        "failed": failed,
        "sheets_exported": sheets_exported,     # optional debug signal
        "sheets_error": sheets_error,           # optional debug signal
    }


@router.get("/events")
def get_events_history(
    job_uuid: Optional[str] = Query(default=None),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return synced events so any device can rebuild its local activity log.
    If job_uuid is provided, filters to that job only.
    Sorted newest-first. Used by the frontend on startup to restore history on a new device.
    """
    q = db.query(Event)
    if job_uuid:
        q = q.filter(Event.job_uuid == job_uuid)
    rows = q.order_by(Event.timestamp.desc()).limit(limit).all()

    return {
        "ok": True,
        "events": [
            {
                "event_id": e.event_id,
                "job_uuid": e.job_uuid,
                "type": e.type,
                "timestamp": e.timestamp.isoformat() + "Z",
                "lat": e.lat,
                "lng": e.lng,
                "accuracy_m": e.accuracy_m,
                "note": e.note,
                "job_name": e.job_name or "",
                "created_by": e.created_by or "",
                "sync_status": "synced",
            }
            for e in rows
        ],
    }


class EventNotePatch(BaseModel):
    note: Optional[str] = None


@router.patch("/events/{event_id}")
def patch_event_note(
    event_id: str,
    payload: EventNotePatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attach or replace the free-text note on an already-logged event.

    Keeps the event row intact (timestamp, location, author) and overwrites
    only the `note` column in Postgres and in the Events sheet tab. If the
    event hasn't been exported to the sheet yet, the update_event_note_in_sheets
    call is a no-op — the note will ship out on first export via the normal
    sync path.
    """
    row = db.query(Event).filter(Event.event_id == event_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="event_not_found")

    note = (payload.note or "").strip() or None
    row.note = note
    db.commit()

    # Run the sheet update synchronously (not via the background pool) so
    # memory is bounded by uvicorn's worker count, not by an unbounded pool
    # queue. `/api/sync` follows the same pattern for its event export. A
    # sheet failure must never fail the PATCH — Postgres is the source of
    # truth; the sheet will catch up on the next edit or full re-export.
    sheet_error = None
    try:
        update_event_note_in_sheets(db, event_id, note)
    except Exception as ex:
        sheet_error = str(ex)

    return {"ok": True, "event_id": event_id, "note": note or "", "sheet_error": sheet_error}


@router.get("/jobs/resolve")
def resolve_calendar_job(
    calendar_event_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return (or create) the canonical job_uuid for a Google Calendar event ID.
    All devices calling this with the same calendar_event_id receive the same
    job_uuid, ensuring cross-device event history is unified under one key.
    """
    row = db.query(CalendarJob).filter(
        CalendarJob.calendar_event_id == calendar_event_id
    ).first()

    if row:
        return {"ok": True, "job_uuid": row.job_uuid, "created": False}

    new_uuid = str(_uuid.uuid4())
    row = CalendarJob(calendar_event_id=calendar_event_id, job_uuid=new_uuid)
    db.add(row)
    db.commit()
    return {"ok": True, "job_uuid": new_uuid, "created": True}
