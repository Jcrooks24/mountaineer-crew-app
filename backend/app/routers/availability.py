"""
Availability router.

Crew submit forward-looking scheduling availability one 14-day window at a
time. Endpoints:

  GET  /api/availability                 - caller's own days + horizon
  GET  /api/availability?all_users=true  - admin-only audit view
  POST /api/availability                 - upsert a batch of (day, status)

Upsert key is (user_id, day): a re-submission for the same day overwrites
in place rather than stacking rows.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import List, Optional

# Days within this window of today are immutable on the device. Mirrored on
# the backend so a tampered client can't sneak in a change to a locked day.
LOCK_WINDOW_DAYS = 14

# availability_days grows one row per (user, day) forever. These bounds keep the
# read endpoints from scanning the whole table into a 512 MB worker's memory.
# A user only ever edits the current + future windows, and the admin views only
# render a rolling window, so old rows are never needed by a live screen.
_OWN_STATE_HISTORY_FLOOR_DAYS = 120   # caller's own /availability
_AUDIT_HISTORY_FLOOR_DAYS = 180       # admin /availability/all
_AUDIT_ROW_CAP = 20000                # hard backstop on the audit scan
_RANGE_MAX_SPAN_DAYS = 92             # admin /range clamp


def _iso_days_ago(n: int) -> str:
    return date.fromordinal(date.today().toordinal() - n).isoformat()

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.availability import AVAILABILITY_STATUSES, AvailabilityDay
from app.db.models.availability_unlock import AvailabilityUnlock
from app.db.models.user import User
from app.integrations.sheets_export import (
    schedule_availability_export,
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


def _contiguous_horizon(day_strs: set[str], today: date) -> Optional[str]:
    """The last day H such that every day in [today, H] has a submitted
    record (contiguous, starting at today). Returns None when today itself
    has no record.

    This is deliberately NOT max(submitted day): a far-future one-off
    absence (e.g. a vacation pre-submitted months out via "Plan a future
    absence") must not inflate the horizon past the near-term gap. If it
    did, isHorizonLow() would read false and the rolling 2-week submission
    picker would stay hidden until that distant date entered the window -
    the crew member couldn't submit their next two weeks. Anchoring on
    contiguous coverage from today keeps the rolling cadence prompting
    while still letting isolated future absences sit untouched in the data.
    """
    if today.isoformat() not in day_strs:
        return None
    cur = today
    while True:
        nxt = date.fromordinal(cur.toordinal() + 1)
        if nxt.isoformat() in day_strs:
            cur = nxt
        else:
            return cur.isoformat()


def _state_for_user(db: Session, user_id: int) -> AvailabilityState:
    # Floor at recent history: the horizon only looks forward from today and the
    # UI only edits current/future windows, so scanning years of past rows on
    # this hot path is pure memory cost.
    rows = (
        db.query(AvailabilityDay)
        .filter(AvailabilityDay.user_id == user_id)
        .filter(AvailabilityDay.day >= _iso_days_ago(_OWN_STATE_HISTORY_FLOOR_DAYS))
        .order_by(AvailabilityDay.day.asc())
        .all()
    )
    horizon = _contiguous_horizon({r.day for r in rows}, date.today())
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
    """Schedule a COALESCED sheet refresh for one (user, window).

    This used to read the DB and fire an uncoalesced background export per call.
    An admin editing a run of days on the month grid then fired one export per
    edit, each doing ~4 Google Sheets reads, which blew the 60-reads/min quota
    (429s) and piled unbounded tasks onto the 2-worker export pool - a rate-limit
    and memory problem at once. schedule_availability_export coalesces a burst for
    the same (user, window) into one write of the final state, and its worker
    re-reads the DB itself (name/email included), so the read here is no longer
    needed. user_name/user_email are kept in the signature for the callers but are
    now looked up in the worker.
    """
    schedule_availability_export(user_id, window_start)


@router.get("", response_model=AvailabilityState)
def get_state(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Caller's own availability state - horizon + all submitted days."""
    return _state_for_user(db, current_user.id)


@router.get("/all", response_model=List[AvailabilityDayOut])
def list_all(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin audit endpoint - every crew member's recent + future days.

    Floored to recent history and hard-capped: this scans every user at once, so
    an unbounded read of a forever-growing table is a direct OOM risk on the
    512 MB worker. Old windows are past the lock and never edited, so dropping
    them costs the audit nothing a live screen uses.
    """
    rows = (
        db.query(AvailabilityDay)
        .filter(AvailabilityDay.day >= _iso_days_ago(_AUDIT_HISTORY_FLOOR_DAYS))
        .order_by(AvailabilityDay.user_name.asc(), AvailabilityDay.day.asc())
        .limit(_AUDIT_ROW_CAP)
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
    # Defensive cap: the legitimate flows are a 14-day rolling submission
    # or a chunk of a future-period pre-submission, neither of which ever
    # comes close to 100. Hard-limit anything larger so a tampered client
    # can't slip an unbounded range through.
    if len(body.days) > 100:
        raise HTTPException(
            status_code=400,
            detail="Too many days in one submission (max 100).",
        )

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
    # within LOCK_WINDOW_DAYS of today cannot be changed via this endpoint -
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
            # The lock applies only to *modifying* an already-submitted day.
            # A never-submitted day in the window (no existing row) stays
            # editable, and re-submitting an already-submitted day with its
            # unchanged value is a no-op - neither should trip the lock. Only a
            # genuine value change to a submitted day requires an admin unlock.
            if existing:
                new_note = (entry.note or "").strip() or None
                if existing.status != entry.status or (existing.note or None) != new_note:
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
    no expiration in the data model - admin revokes manually when the
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

    # Idempotent grant - if an unlock already exists for (user, window),
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
    `note` is included because the month grid is read-only - anyone editing
    individual days drops back into the per-user editor on the Availability
    page."""
    user_id: int
    day: str
    status: str
    note: Optional[str] = None
    window_start: str


class ScheduledJobRow(BaseModel):
    """One row per (user_id, day, job_title) for events on the Jobs calendar
    where the user appears as an undeclined attendee. Aliases are resolved
    via the same email_to_user_id map Crew Resources uses, so a job
    invitation sent to an alternate email still lands on the right crew
    member in the month view."""
    user_id: int
    day: str
    title: str


class AvailabilityRangeResponse(BaseModel):
    days: List[AvailabilityRangeRow]
    scheduled: List[ScheduledJobRow]


# Declared BEFORE the /{user_id} route below so FastAPI doesn't misroute
# /range as user_id="range".
@admin_per_user_router.get("/range", response_model=AvailabilityRangeResponse)
def admin_get_range(
    start: str = Query(..., description="Inclusive ISO date YYYY-MM-DD"),
    end: str = Query(..., description="Inclusive ISO date YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Every (user_id, day, status, note) availability record + every
    scheduled job (from the Jobs calendar) within [start, end] inclusive.
    Powers the month-wide view in the admin Employees tab so admin sees
    the whole crew at once - both their submitted availability and what
    they're already on the hook for."""
    try:
        date.fromisoformat(start)
        date.fromisoformat(end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad start/end date")
    if end < start:
        raise HTTPException(status_code=400, detail="end must be >= start")
    # Clamp the span so a client can't request a multi-year range that scans the
    # whole table across every user into the 512 MB worker. The month grid only
    # ever asks for ~30-60 days.
    if (date.fromisoformat(end).toordinal() - date.fromisoformat(start).toordinal()) > _RANGE_MAX_SPAN_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Range too wide (max {_RANGE_MAX_SPAN_DAYS} days).",
        )

    rows = (
        db.query(AvailabilityDay)
        .filter(AvailabilityDay.day >= start, AvailabilityDay.day <= end)
        .order_by(AvailabilityDay.user_id.asc(), AvailabilityDay.day.asc())
        .all()
    )
    days = [
        AvailabilityRangeRow(
            user_id=r.user_id,
            day=r.day,
            status=r.status,
            note=r.note,
            window_start=r.window_start,
        )
        for r in rows
    ]

    # Scheduled jobs from the Jobs calendar over the same range. Failures
    # here (calendar down, scope missing, etc) MUST NOT block availability -
    # admin still wants to see the matrix. Log + return empty list.
    scheduled: List[ScheduledJobRow] = []
    try:
        from datetime import time, timedelta
        from app.integrations.crew_resources_calendar import (
            LOCAL_TZ,
            _email_to_user_id,
            _get_calendar_svc,
            _jobs_calendar_id,
        )
        jobs_id = _jobs_calendar_id()
        if jobs_id:
            email_to_uid = _email_to_user_id(db)
            svc = _get_calendar_svc(db)
            start_local = datetime.combine(
                date.fromisoformat(start), time(0, 0, 0), tzinfo=LOCAL_TZ
            )
            end_local = datetime.combine(
                date.fromisoformat(end), time(0, 0, 0), tzinfo=LOCAL_TZ
            ) + timedelta(days=1)
            # Paginate via nextPageToken - a busy month can easily exceed
            # 2500 (single page max). Without the loop, the tail of the
            # month would silently disappear from the matrix.
            items: List[dict] = []
            page_token: Optional[str] = None
            while True:
                resp = svc.events().list(
                    calendarId=jobs_id,
                    timeMin=start_local.isoformat(),
                    timeMax=end_local.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=2500,
                    pageToken=page_token,
                ).execute()
                items.extend(resp.get("items", []))
                page_token = resp.get("nextPageToken")
                if not page_token:
                    break
            for it in items:
                attendees = it.get("attendees") or []
                if not attendees:
                    continue
                title = (it.get("summary") or "(no title)").strip()
                start_dt = it.get("start") or {}
                # Resolve the calendar day this event belongs to. Prefer
                # the local-time date of dateTime events so a 11pm event
                # doesn't get bucketed under UTC tomorrow.
                day_iso: Optional[str] = None
                if start_dt.get("dateTime"):
                    try:
                        dt = datetime.fromisoformat(
                            start_dt["dateTime"].replace("Z", "+00:00")
                        )
                        day_iso = dt.astimezone(LOCAL_TZ).date().isoformat()
                    except ValueError:
                        day_iso = None
                elif start_dt.get("date"):
                    day_iso = start_dt["date"]
                if not day_iso:
                    continue
                if day_iso < start or day_iso > end:
                    # Out-of-range edge case (multi-day event starting
                    # before our window).
                    continue
                for a in attendees:
                    email = (a.get("email") or "").strip().lower()
                    if not email:
                        continue
                    if a.get("responseStatus") == "declined":
                        continue
                    uid = email_to_uid.get(email)
                    if uid is None:
                        continue
                    scheduled.append(
                        ScheduledJobRow(user_id=uid, day=day_iso, title=title)
                    )
    except Exception as exc:
        print(f"[admin-range] scheduled jobs fetch failed: {exc}")

    return AvailabilityRangeResponse(days=days, scheduled=scheduled)


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
    no 14-day-lock or window-bounds check - the office is trusted to
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
            # stays grouped where it was - body.window_start is only used
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

    # Log ids only - same PII-in-logs rule we apply to auth + dvir flows.
    print(
        f"[availability] admin override: admin {admin.id} edited "
        f"{len(body.days)} day(s) for user {user_id}"
    )

    return _state_for_user(db, user_id)
