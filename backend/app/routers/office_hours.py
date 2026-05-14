"""
Office Hours router.

Admin-only endpoints for office staff to log hours that aren't tied to a
crew job. Lands in its own Google Sheet worksheet (configured via
SHEETS_OFFICE_HOURS_TAB) so it doesn't pollute the per-job JobReports
sheet — those rows are job-uuid-keyed and office hours have no job.

All endpoints require admin role. Idempotent on entry_uuid (same offline
retry pattern as materials_submissions).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.db.models.office_hours import OfficeHoursEntry
from app.db.models.user import User
from app.integrations.sheets_export import (
    export_office_hours_to_sheets,
    run_export_in_background,
)

router = APIRouter(prefix="/api/office-hours", tags=["office-hours"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class OfficeHoursIn(BaseModel):
    entry_uuid: str
    work_date: str       # ISO YYYY-MM-DD
    start_time: str      # HH:MM
    end_time: str        # HH:MM
    break_hours: float = 0.0
    hours: float         # derived on client (so the round-trip is auditable)
    notes: Optional[str] = ""


class OfficeHoursOut(BaseModel):
    entry_uuid: str
    user_name: str
    work_date: str
    start_time: str
    end_time: str
    break_hours: float
    hours: float
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


def _to_out(row: OfficeHoursEntry) -> OfficeHoursOut:
    return OfficeHoursOut(
        entry_uuid=row.entry_uuid,
        user_name=row.user_name,
        work_date=row.work_date,
        start_time=row.start_time,
        end_time=row.end_time,
        break_hours=row.break_hours or 0.0,
        hours=row.hours or 0.0,
        notes=row.notes or "",
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _queue_export(row: OfficeHoursEntry) -> None:
    payload = {
        "entry_uuid": row.entry_uuid,
        "user_name": row.user_name,
        "work_date": row.work_date,
        "start_time": row.start_time,
        "end_time": row.end_time,
        "break_hours": row.break_hours or 0.0,
        "hours": row.hours or 0.0,
        "notes": row.notes or "",
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    run_export_in_background(export_office_hours_to_sheets, payload)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[OfficeHoursOut])
def list_entries(
    mine_only: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """List office-hours entries newest-first. Admin sees their own by
    default (the table is meant to feel like a personal time log); an
    admin-of-admins can pass mine_only=false to audit everyone."""
    q = db.query(OfficeHoursEntry)
    if mine_only:
        q = q.filter(OfficeHoursEntry.user_id == current_user.id)
    rows = q.order_by(OfficeHoursEntry.work_date.desc(), OfficeHoursEntry.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]


@router.post("", response_model=OfficeHoursOut)
def upsert_entry(
    body: OfficeHoursIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create or update an entry. Idempotent on entry_uuid — the offline
    retry path POSTs the same id; if the row already exists we treat it
    as an edit only when the submitter matches."""
    now = datetime.now(timezone.utc)
    existing = (
        db.query(OfficeHoursEntry)
        .filter(OfficeHoursEntry.entry_uuid == body.entry_uuid)
        .first()
    )

    if existing:
        if existing.user_id and existing.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="You can only edit your own entries")
        existing.work_date = body.work_date
        existing.start_time = body.start_time
        existing.end_time = body.end_time
        existing.break_hours = body.break_hours
        existing.hours = body.hours
        existing.notes = body.notes or ""
        existing.updated_at = now
        try:
            db.commit()
            db.refresh(existing)
        except SQLAlchemyError:
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to update entry")
        _queue_export(existing)
        return _to_out(existing)

    row = OfficeHoursEntry(
        entry_uuid=body.entry_uuid,
        user_id=current_user.id,
        user_name=current_user.name or current_user.email,
        work_date=body.work_date,
        start_time=body.start_time,
        end_time=body.end_time,
        break_hours=body.break_hours,
        hours=body.hours,
        notes=body.notes or "",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        # Concurrent POST with the same entry_uuid (offline replay racing a
        # fresh attempt). Fall back to the existing row so the client sees
        # an OK response and the queue clears.
        db.rollback()
        row = (
            db.query(OfficeHoursEntry)
            .filter(OfficeHoursEntry.entry_uuid == body.entry_uuid)
            .first()
        )
        if not row:
            raise HTTPException(status_code=500, detail="Failed to save entry")
        return _to_out(row)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save entry")

    _queue_export(row)
    return _to_out(row)


@router.delete("/{entry_uuid}")
def delete_entry(
    entry_uuid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete an entry. Idempotent — returns ok even if absent. Sheet rows
    are append-only and aren't retro-deleted (matches the rest of the app:
    admins read the sheet, deletions are visible by their absence in DB
    and by the next export not refreshing them)."""
    row = (
        db.query(OfficeHoursEntry)
        .filter(OfficeHoursEntry.entry_uuid == entry_uuid)
        .first()
    )
    if row is None:
        return {"ok": True, "deleted": False}

    if row.user_id and row.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own entries")

    db.delete(row)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete entry")
    return {"ok": True, "deleted": True}
