import json
import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel

from app.db.session import get_db
from app.db.models.event import Event
from app.db.models.calendar_job import CalendarJob
from app.integrations.sheets_export import (
    delete_event_from_sheets,
    export_events_to_sheets,
    run_export_in_background,
    update_event_note_in_sheets,
    update_event_timestamp_in_sheets,
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
            # A malformed timestamp can't be fixed by retrying - permanent.
            failed.append({
                "event_id": e.event_id,
                "reason": "bad_timestamp",
                "timestamp": e.timestamp,
                "retryable": False,
            })
            continue

        row = Event(
            event_id=e.event_id,
            job_uuid=e.job_uuid,
            job_id=e.job_id,
            type=e.type,
            # On insert, the editable event time and the immutable
            # logged_at are the same - the crew member's device time at
            # capture. They diverge only after the user edits the
            # timestamp from the timeline.
            timestamp=ts,
            logged_at=ts,
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

            # Collect for sheets export (use original ISO string). On first
            # export, logged_at == timestamp; the sheet's logged_at column
            # only diverges after a later timestamp edit.
            inserted_events_for_sheet.append({
                "event_id": e.event_id,
                "timestamp": e.timestamp,
                "logged_at": e.timestamp,
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
            # A DB error here is almost always transient (connection blip,
            # timeout, deadlock on the small Render instance) - the event
            # never inserted, so the client must keep it queued and retry.
            # Marking it non-retryable would silently lose a logged event.
            failed.append({
                "event_id": e.event_id,
                "reason": "db_error",
                "retryable": True,
            })

    # Export to Sheets in the bounded background pool - keeps the request
    # thread from holding the events list + an in-flight googleapiclient call
    # at the same time. The reconciler is the safety net if a background
    # export fails. Returning sheets_exported=None preserves the response
    # shape; clients only ever used it as a debug signal.
    if inserted_events_for_sheet:
        run_export_in_background(export_events_to_sheets, inserted_events_for_sheet)

    return {
        "ok": True,
        "inserted": inserted,
        "duplicates": duplicates,
        "errors": errors,
        "failed": failed,
        "sheets_exported": None,                # async - see reconciler
        "sheets_error": None,
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
    Sorted newest-first. Used by the frontend on startup to restore history
    on a new device.

    Streams the response so a 5000-row pull doesn't materialize the full
    list of dicts in memory before serialization. Mirrors the materials
    endpoint's approach.
    """
    q = db.query(Event)
    if job_uuid:
        q = q.filter(Event.job_uuid == job_uuid)
    rows = q.order_by(Event.timestamp.desc()).limit(limit).yield_per(200)

    def gen():
        yield b'{"ok":true,"events":['
        first = True
        for e in rows:
            obj = {
                "event_id": e.event_id,
                "job_uuid": e.job_uuid,
                "type": e.type,
                "timestamp": e.timestamp.isoformat() + "Z",
                "logged_at": (e.logged_at.isoformat() + "Z") if e.logged_at else None,
                "lat": e.lat,
                "lng": e.lng,
                "accuracy_m": e.accuracy_m,
                "note": e.note,
                "job_name": e.job_name or "",
                "created_by": e.created_by or "",
                "sync_status": "synced",
            }
            chunk = json.dumps(obj).encode("utf-8")
            yield (b"," if not first else b"") + chunk
            first = False
        yield b"]}"

    return StreamingResponse(gen(), media_type="application/json")


class EventPatch(BaseModel):
    """Patches against a previously-logged event. Both fields are optional;
    omitted fields are not modified. Sending both in one request is fine.
    """
    note: Optional[str] = None
    # ISO-8601 string. Crew can correct an event's displayed time after the
    # fact. logged_at is never editable.
    timestamp: Optional[str] = None


def _validate_editable_timestamp(new_ts_iso: str) -> datetime:
    try:
        new_ts = datetime.fromisoformat(new_ts_iso.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="bad_timestamp")
    # Normalize to naive UTC so the stored timestamp matches how /api/sync
    # stores datetimes (the `timestamp` column is naive UTC).
    if new_ts.tzinfo is not None:
        new_ts = new_ts.astimezone(timezone.utc).replace(tzinfo=None)
    return new_ts


@router.patch("/events/{event_id}")
def patch_event(
    event_id: str,
    payload: EventPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update mutable fields on an already-logged event.

    Currently `note` and `timestamp`. The row's `logged_at`, location, and
    author stay intact. Each PATCH commits Postgres first, then writes the
    same change into the Events sheet. If the event hasn't been exported
    yet, the sheet call is a no-op - the row will ship via the normal sync
    path with the latest values.
    """
    row = db.query(Event).filter(Event.event_id == event_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="event_not_found")

    note_changed = False
    timestamp_changed = False
    new_note: Optional[str] = None
    new_ts: Optional[datetime] = None

    if payload.note is not None:
        new_note = (payload.note or "").strip() or None
        row.note = new_note
        note_changed = True

    if payload.timestamp is not None:
        new_ts = _validate_editable_timestamp(payload.timestamp)
        row.timestamp = new_ts
        timestamp_changed = True

    if not (note_changed or timestamp_changed):
        return {"ok": True, "event_id": event_id, "noop": True}

    db.commit()

    # Run the sheet updates synchronously (not via the background pool) so
    # memory is bounded by uvicorn's worker count. A sheet failure must never
    # fail the PATCH - Postgres is the source of truth; the reconciler /
    # next edit catches up on missed sheet writes.
    sheet_error: Optional[str] = None
    try:
        if note_changed:
            update_event_note_in_sheets(db, event_id, new_note)
        if timestamp_changed and new_ts is not None:
            update_event_timestamp_in_sheets(db, event_id, new_ts.isoformat())
    except Exception as ex:
        sheet_error = str(ex)

    return {
        "ok": True,
        "event_id": event_id,
        "note": (new_note or "") if note_changed else None,
        "timestamp": new_ts.isoformat() if timestamp_changed and new_ts else None,
        "sheet_error": sheet_error,
    }


@router.delete("/events/{event_id}")
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an event logged in error (removes the derived RODS duty change too
    when it's a DUTY event). Idempotent: a missing event is a no-op. Postgres is
    the source of truth; the sheet row is removed best-effort."""
    row = db.query(Event).filter(Event.event_id == event_id).first()
    if row is None:
        return {"ok": True, "event_id": event_id, "noop": True}
    db.delete(row)
    db.commit()

    sheet_error: Optional[str] = None
    try:
        delete_event_from_sheets(db, event_id)
    except Exception as ex:  # a sheet failure must never fail the delete
        sheet_error = str(ex)

    return {"ok": True, "event_id": event_id, "sheet_error": sheet_error}


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
