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
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.availability import AVAILABILITY_STATUSES, AvailabilityDay
from app.db.models.availability_unlock import AvailabilityUnlock
from app.db.models.user import User
from app.integrations.sheets_export import (
    export_availability_window_to_sheets,
    run_export_in_background,
)
from app.schemas.availability import (
    AvailabilityBatchIn,
    AvailabilityDayOut,
    AvailabilityState,
    AvailabilityUnlockOut,
)

router = APIRouter(prefix="/api/availability", tags=["availability"])
unlocks_router = APIRouter(
    prefix="/api/admin/availability-unlocks", tags=["availability"]
)


def _unlock_to_out(row: AvailabilityUnlock) -> AvailabilityUnlockOut:
    return AvailabilityUnlockOut(
        id=row.id,
        window_start=row.window_start,
        granted_by_name=row.granted_by_name,
        granted_at=row.granted_at,
        note=row.note,
    )


def _active_unlock_windows(db: Session, user_id: int) -> set[str]:
    """The set of window_starts the caller has an active unlock for. Used
    by the submit handler to bypass the locked-day reject for those windows."""
    rows = (
        db.query(AvailabilityUnlock.window_start)
        .filter(AvailabilityUnlock.user_id == user_id)
        .all()
    )
    return {r[0] for r in rows}


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
    unlock_rows = (
        db.query(AvailabilityUnlock)
        .filter(AvailabilityUnlock.user_id == user_id)
        .order_by(AvailabilityUnlock.window_start.asc())
        .all()
    )
    return AvailabilityState(
        horizon=horizon,
        days=[_to_out(r) for r in rows],
        unlocks=[_unlock_to_out(u) for u in unlock_rows],
    )


def _queue_window_export(
    db: Session,
    user_id: int,
    user_name: str,
    user_email: str,
    window_start: str,
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
        "user_email": user_email,
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

    try:
        window_start_date = date.fromisoformat(body.window_start)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Bad window_start: {body.window_start}"
        )
    window_end_date = date.fromordinal(window_start_date.toordinal() + 13)

    unlocked_windows = _active_unlock_windows(db, current_user.id)
    window_unlocked = body.window_start in unlocked_windows

    # Locked-day reject: any day that already exists on the server AND falls
    # within LOCK_WINDOW_DAYS of today cannot be changed via this endpoint —
    # unless admin has granted an unlock for this specific window. We reject
    # the entire batch (not per-day) so the device never half-commits a
    # window the user thought they submitted.
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

        # Sanity: every day in the batch must fall within the declared
        # window. Prevents a malicious client from laundering arbitrary
        # days through an unlock for a different window.
        if not (window_start_date <= day_date <= window_end_date):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Day {entry.day} is outside the declared window "
                    f"({body.window_start} → {window_end_date.isoformat()})"
                ),
            )

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
    if locked_changes and not window_unlocked:
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

    _queue_window_export(
        db,
        current_user.id,
        user_name,
        current_user.email or "",
        touched_window,
    )

    return _state_for_user(db, current_user.id)


# ── Admin: unlock CRUD ──────────────────────────────────────────────────────


class AvailabilityUnlockIn(BaseModel):
    user_id: int
    window_start: str       # YYYY-MM-DD
    note: Optional[str] = None


@unlocks_router.get("", response_model=List[AvailabilityUnlockOut])
def list_unlocks(
    user_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """All active unlocks, or just one user's if user_id is supplied. There's
    no expiration in the data model — admin revokes manually when the
    exception window has passed."""
    q = db.query(AvailabilityUnlock)
    if user_id is not None:
        q = q.filter(AvailabilityUnlock.user_id == user_id)
    rows = q.order_by(
        AvailabilityUnlock.user_name.asc(),
        AvailabilityUnlock.window_start.asc(),
    ).all()
    return [_unlock_to_out(r) for r in rows]


@unlocks_router.post("", response_model=AvailabilityUnlockOut, status_code=201)
def grant_unlock(
    body: AvailabilityUnlockIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    try:
        date.fromisoformat(body.window_start)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"window_start must be YYYY-MM-DD: {body.window_start}"
        )
    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Idempotent grant — if an unlock already exists for (user, window),
    # patch the note + granted_by fields and return that row. Saves admins
    # from having to revoke + re-grant when adjusting the note.
    existing = (
        db.query(AvailabilityUnlock)
        .filter(
            AvailabilityUnlock.user_id == body.user_id,
            AvailabilityUnlock.window_start == body.window_start,
        )
        .first()
    )
    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    if existing:
        existing.granted_by_id = admin.id
        existing.granted_by_name = admin.name or admin.email or ""
        existing.granted_at = now
        existing.note = note
        db.commit()
        db.refresh(existing)
        return _unlock_to_out(existing)

    row = AvailabilityUnlock(
        user_id=body.user_id,
        user_name=user.name or user.email or "",
        window_start=body.window_start,
        granted_by_id=admin.id,
        granted_by_name=admin.name or admin.email or "",
        granted_at=now,
        note=note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _unlock_to_out(row)


@unlocks_router.delete("/{unlock_id}", status_code=204)
def revoke_unlock(
    unlock_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(AvailabilityUnlock).filter(AvailabilityUnlock.id == unlock_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Unlock not found")
    db.delete(row)
    db.commit()
    return None


# ── Admin: per-user availability override ──────────────────────────────────


admin_per_user_router = APIRouter(
    prefix="/api/admin/availability", tags=["availability"]
)


class AvailabilityRangeRow(BaseModel):
    """Compact (user, day, status) record returned by /range so the admin
    month view can build its matrix without an N+1 per-user fetch.
    `note` is included because the month grid is read-only — anyone editing
    individual days drops back into the per-user editor on the Availability
    page."""
    user_id: int
    day: str
    status: str
    note: Optional[str] = None
    window_start: str


# Declared BEFORE the /{user_id} route below so FastAPI doesn't misroute
# /range as user_id="range".
@admin_per_user_router.get("/range", response_model=List[AvailabilityRangeRow])
def admin_get_range(
    start: str = Query(..., description="Inclusive ISO date YYYY-MM-DD"),
    end: str = Query(..., description="Inclusive ISO date YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Every (user_id, day, status, note) record within [start, end]
    inclusive, sorted by user_id then day. Powers the month-wide view
    in the admin Employees tab so admin sees the whole crew at once."""
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad start/end date")
    if end < start:
        raise HTTPException(status_code=400, detail="end must be >= start")

    rows = (
        db.query(AvailabilityDay)
        .filter(AvailabilityDay.day >= start, AvailabilityDay.day <= end)
        .order_by(AvailabilityDay.user_id.asc(), AvailabilityDay.day.asc())
        .all()
    )
    return [
        AvailabilityRangeRow(
            user_id=r.user_id,
            day=r.day,
            status=r.status,
            note=r.note,
            window_start=r.window_start,
        )
        for r in rows
    ]


@admin_per_user_router.get("/{user_id}", response_model=AvailabilityState)
def admin_get_user_state(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Read any crew member's full availability state. Used by the
    admin-side editor on /availability so the office can manually correct
    a past submission without asking the crew member to redo it."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _state_for_user(db, user_id)


@admin_per_user_router.post("/{user_id}", response_model=AvailabilityState)
def admin_upsert_user_state(
    user_id: int,
    body: AvailabilityBatchIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Bulk-upsert a crew member's availability days, bypassing the
    lock-window rule. Same input shape as the crew-facing POST but with
    no 14-day-lock or window-bounds check — the office is trusted to
    enter correct data, and that's the whole point of the override.

    Sheet export still groups by (user, window_start), so admin should
    pass a sensible window_start that matches the days they're touching.
    """
    if not body.days:
        raise HTTPException(status_code=400, detail="No days provided")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.now(timezone.utc)
    user_name = user.name or user.email or ""

    for entry in body.days:
        if entry.status not in AVAILABILITY_STATUSES:
            raise HTTPException(
                status_code=400, detail=f"Invalid status: {entry.status}"
            )
        try:
            date.fromisoformat(entry.day)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Bad day: {entry.day}")

    touched_window = body.window_start
    for entry in body.days:
        existing = (
            db.query(AvailabilityDay)
            .filter(
                AvailabilityDay.user_id == user_id,
                AvailabilityDay.day == entry.day,
            )
            .first()
        )
        note = (entry.note or "").strip() or None
        if existing:
            existing.status = entry.status
            existing.note = note
            existing.user_name = user_name
            # Preserve original window_start so the sheet row admin sees
            # stays grouped where it was — body.window_start is only used
            # as a fallback if the row is brand new.
            existing.updated_at = now
        else:
            db.add(
                AvailabilityDay(
                    user_id=user_id,
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

    _queue_window_export(
        db,
        user_id,
        user_name,
        user.email or "",
        touched_window,
    )

    # Log ids only — same PII-in-logs rule we apply to auth + dvir flows.
    print(
        f"[availability] admin override: admin {admin.id} edited "
        f"{len(body.days)} day(s) for user {user_id}"
    )

    return _state_for_user(db, user_id)
