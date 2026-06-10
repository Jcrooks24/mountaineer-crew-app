"""
Availability router.

Crew submit forward-looking scheduling availability one 14-day window at a
time. Endpoints:

  GET  /api/availability                 — caller's own days + horizon
  GET  /api/availability?all_users=true  — admin-only audit view
  POST /api/availability                 — upsert a batch of (day, status)

Upsert key is (user_id, day): a re-submission for the same day overwrites
in place rather than stacking rows.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional

# Days within this window of today are immutable on the device. Mirrored on
# the backend so a tampered client can't sneak in a change to a locked day.
LOCK_WINDOW_DAYS = 14

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.availability import AVAILABILITY_STATUSES, AvailabilityDay
from app.db.models.user import User
from app.integrations.sheets_export import (
    export_availability_window_to_sheets,
    run_export_in_background,
)
from app.schemas.availability import (
    AvailabilityBatchIn,
    AvailabilityDayOut,
    AvailabilityState,
)

router = APIRouter(prefix="/api/availability", tags=["availability"])


def _to_out(row: AvailabilityDay) -> AvailabilityDayOut:
    return AvailabilityDayOut(
        day=row.day,
        status=row.status,
        note=row.note,
        window_start=row.window_start,
        updated_at=row.updated_at,
    )


def _state_for_user(db: Session, user_id: int) -> AvailabilityState:
    rows = (
        db.query(AvailabilityDay)
        .filter(AvailabilityDay.user_id == user_id)
        .order_by(AvailabilityDay.day.asc())
        .all()
    )
    horizon = rows[-1].day if rows else None
    return AvailabilityState(horizon=horizon, days=[_to_out(r) for r in rows])


def _queue_window_export(
    db: Session, user_id: int, user_name: str, window_start: str
) -> None:
    """Refresh the sheet row for one (user, window) by reading the current
    state out of the DB and pushing it to AvailabilityStaging. Kept here so
    the export captures the post-commit state — the background thread only
    needs the prepared payload, not a live db handle.
    """
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
        return
    payload = {
        "user_id": user_id,
        "user_name": user_name,
        "window_start": window_start,
        "days": [
            {
                "day": r.day,
                "status": r.status,
                "note": r.note or "",
                "updated_at": r.updated_at,
            }
            for r in rows
        ],
    }
    run_export_in_background(export_availability_window_to_sheets, payload)


@router.get("", response_model=AvailabilityState)
def get_state(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Caller's own availability state — horizon + all submitted days."""
    return _state_for_user(db, current_user.id)


@router.get("/all", response_model=List[AvailabilityDayOut])
def list_all(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin audit endpoint — every crew member's days, no horizon."""
    rows = (
        db.query(AvailabilityDay)
        .order_by(AvailabilityDay.user_name.asc(), AvailabilityDay.day.asc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("", response_model=AvailabilityState)
def submit_batch(
    body: AvailabilityBatchIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.days:
        raise HTTPException(status_code=400, detail="No days provided")

    now = datetime.now(timezone.utc)
    user_name = current_user.name or current_user.email or ""
    today = date.today()

    # Locked-day reject: any day that already exists on the server AND falls
    # within LOCK_WINDOW_DAYS of today cannot be changed via this endpoint.
    # Crew must contact admin. We reject the entire batch (not per-day) so
    # the device never half-commits a window the user thought they submitted.
    locked_changes: list[str] = []
    for entry in body.days:
        if entry.status not in AVAILABILITY_STATUSES:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {entry.status}"
            )
        try:
            day_date = date.fromisoformat(entry.day)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Bad day: {entry.day}")
        days_ahead = (day_date - today).days
        if days_ahead < LOCK_WINDOW_DAYS:
            existing = (
                db.query(AvailabilityDay)
                .filter(
                    AvailabilityDay.user_id == current_user.id,
                    AvailabilityDay.day == entry.day,
                )
                .first()
            )
            if existing:
                locked_changes.append(entry.day)
    if locked_changes:
        raise HTTPException(
            status_code=409,
            detail=(
                "Days within the next 2 weeks are locked. "
                "Contact the office to change: " + ", ".join(sorted(set(locked_changes)))
            ),
        )

    # Per-day upsert keyed on (user_id, day). All days in this batch carry the
    # same window_start so the sheet aggregator can re-group them later.
    touched_window = body.window_start
    for entry in body.days:
        existing = (
            db.query(AvailabilityDay)
            .filter(
                AvailabilityDay.user_id == current_user.id,
                AvailabilityDay.day == entry.day,
            )
            .first()
        )
        note = (entry.note or "").strip() or None
        if existing:
            existing.status = entry.status
            existing.note = note
            existing.user_name = user_name
            existing.window_start = body.window_start
            existing.updated_at = now
        else:
            db.add(
                AvailabilityDay(
                    user_id=current_user.id,
                    user_name=user_name,
                    day=entry.day,
                    status=entry.status,
                    note=note,
                    window_start=body.window_start,
                    created_at=now,
                    updated_at=now,
                )
            )

    db.commit()

    _queue_window_export(db, current_user.id, user_name, touched_window)

    return _state_for_user(db, current_user.id)
