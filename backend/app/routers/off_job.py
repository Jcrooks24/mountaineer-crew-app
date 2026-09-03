"""
Off-job hours router.

Crew log hours for work done outside of any job (rare, usually pre-approved).
Idempotent by entry_uuid so the offline queue can safely retry. Admin reads the
full log. Each write mirrors to the OffJobHours sheet tab. Modeled on the
incidents router.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.pto import PTO_PAY_STRUCTURE, check_pto_allowed, pto_balance
from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.off_job_entry import OffJobEntry
from app.db.models.user import User
from app.integrations.sheets_export import export_off_job_to_sheets, run_export_in_background


router = APIRouter(prefix="/api/off-job-hours", tags=["off-job-hours"])
admin_router = APIRouter(prefix="/api/admin/off-job-hours", tags=["off-job-hours"])

# What a CREW MEMBER may log for themselves.
CREW_PAY_STRUCTURES = {"regular", "non_billable", "other"}

# PTO is stored as an off-job pay structure because that is where it has to land
# for payroll to pick it up, but it is OFFICE-ONLY in every other respect (user
# direction, 2026-09-03): crew never log it, never see it on their own off-job
# list, and never see it in Worked Hours. The office records it against somebody.
#
# So this set is what the STORAGE accepts, and CREW_PAY_STRUCTURES is what the
# crew endpoint accepts. They are deliberately different, and the difference is
# enforced at the endpoint rather than by hoping the UI never offers the option.
PAY_STRUCTURES = CREW_PAY_STRUCTURES | {PTO_PAY_STRUCTURE}


class OffJobIn(BaseModel):
    entry_uuid: str
    work_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    hours: float = 0
    pay_structure: str = "regular"
    pay_other_note: Optional[str] = None
    notes: str = ""


class OffJobOut(BaseModel):
    id: int
    entry_uuid: str
    submitted_by_name: Optional[str] = None
    work_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    hours: float
    pay_structure: str
    pay_other_note: Optional[str] = None
    notes: str
    created_at: str


def _to_out(e: OffJobEntry) -> OffJobOut:
    return OffJobOut(
        id=e.id,
        entry_uuid=e.entry_uuid,
        submitted_by_name=e.submitted_by_name,
        work_date=e.work_date,
        start_time=e.start_time,
        end_time=e.end_time,
        hours=e.hours or 0,
        pay_structure=e.pay_structure,
        pay_other_note=e.pay_other_note,
        notes=e.notes or "",
        created_at=e.created_at.isoformat() if e.created_at else "",
    )


def _export(e: OffJobEntry) -> None:
    run_export_in_background(export_off_job_to_sheets, _to_out(e).model_dump())


class PtoRecordIn(BaseModel):
    """Office-recorded paid time off for one employee.

    `entry_uuid` is the idempotency key, minted by the admin client, so a retry
    or a double-tap cannot create a second entry - and re-sending it EDITS the
    entry rather than adding to it, which is why the cap check excludes it.
    """
    entry_uuid: str
    user_id: int
    work_date: str
    hours: float
    notes: str = ""


@router.post("", response_model=OffJobOut, status_code=201)
def create_off_job(
    body: OffJobIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.entry_uuid.strip():
        raise HTTPException(status_code=400, detail="entry_uuid required")
    if not (body.notes or "").strip():
        raise HTTPException(status_code=400, detail="Describe what you did")
    if body.hours is None or body.hours <= 0:
        raise HTTPException(status_code=400, detail="Enter hours worked")

    # PTO is not something a crew member can log for themselves. Refused loudly
    # rather than quietly coerced to "regular": a silent downgrade would record
    # paid time off as worked time, which is a worse outcome than an error.
    if body.pay_structure == PTO_PAY_STRUCTURE:
        raise HTTPException(
            status_code=403,
            detail="PTO is recorded by the office, not logged here.",
        )
    pay = body.pay_structure if body.pay_structure in CREW_PAY_STRUCTURES else "regular"

    # Idempotent: the offline queue retries with the same uuid. Update in place.
    e = db.query(OffJobEntry).filter(OffJobEntry.entry_uuid == body.entry_uuid).first()
    now = datetime.now(timezone.utc)
    if e is None:
        e = OffJobEntry(entry_uuid=body.entry_uuid.strip(), created_at=now)
        db.add(e)

    e.submitted_by_id = current_user.id
    e.submitted_by_name = current_user.name or current_user.email
    e.work_date = (body.work_date or "").strip() or None
    e.start_time = (body.start_time or "").strip() or None
    e.end_time = (body.end_time or "").strip() or None
    e.hours = float(body.hours)
    e.pay_structure = pay
    e.pay_other_note = (body.pay_other_note or "").strip() or None
    e.notes = (body.notes or "").strip()
    e.updated_at = now

    db.commit()
    db.refresh(e)
    _export(e)
    return _to_out(e)


@router.get("", response_model=List[OffJobOut])
def list_my_off_job(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(OffJobEntry)
        .filter(
            OffJobEntry.submitted_by_id == current_user.id,
            # PTO the office recorded against this person is deliberately hidden
            # from them here. It is stored as an off-job entry so payroll picks
            # it up; it is not part of what the crew member logged.
            OffJobEntry.pay_structure != PTO_PAY_STRUCTURE,
        )
        .order_by(OffJobEntry.created_at.desc())
        .limit(100)
        .all()
    )
    return [_to_out(r) for r in rows]


@admin_router.get("/pto-balance/{user_id}")
def admin_pto_balance(
    user_id: int,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """One employee's PTO position for a calendar year (default: this one).

    Admin-only, like everything else about PTO. The crew have no endpoint for
    this: they are not shown their balance because they are not the ones logging
    it (user direction, 2026-09-03).
    """
    from datetime import date as _date
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="No such employee on the roster.")
    return pto_balance(db, user, year or _date.today().year)


@admin_router.post("/pto", response_model=OffJobOut, status_code=201)
def admin_record_pto(
    body: PtoRecordIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Record PTO against an employee. Office-only.

    Stored as an off-job entry with `pay_structure = "pto"`, which is what makes
    payroll pick it up - it lands in the `pto` bucket and stays out of overtime.
    It does NOT appear on the employee's own off-job list or in their Worked
    Hours.

    The cap is checked here for the same reason the crew path used to check it:
    PTO spends a finite allowance, and an admin working from a stale screen
    should not be able to overspend somebody's year. `entry_uuid` is excluded
    from the used figure so editing an entry is judged on the change rather than
    on the old value plus the new.
    """
    user = db.query(User).filter(User.id == body.user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="No such employee on the roster.")
    if body.hours is None or body.hours <= 0:
        raise HTTPException(status_code=400, detail="Enter the PTO hours.")

    work_date = (body.work_date or "").strip() or None
    why = check_pto_allowed(
        db, user, work_date, float(body.hours),
        exclude_entry_uuid=body.entry_uuid.strip(),
    )
    if why:
        raise HTTPException(status_code=400, detail=why)

    e = db.query(OffJobEntry).filter(OffJobEntry.entry_uuid == body.entry_uuid).first()
    now = datetime.now(timezone.utc)
    if e is None:
        e = OffJobEntry(entry_uuid=body.entry_uuid.strip(), created_at=now)
        db.add(e)
    elif (e.pay_structure or "") != PTO_PAY_STRUCTURE:
        # Refuse to convert somebody's logged work into PTO by re-using its uuid.
        raise HTTPException(
            status_code=409,
            detail="That entry is not a PTO entry and cannot be turned into one.",
        )

    # submitted_by is WHOSE PTO it is, so payroll attributes it to them.
    # recorded_by is who in the office entered it, which is the audit trail.
    e.submitted_by_id = user.id
    e.submitted_by_name = user.name or user.email
    e.recorded_by_id = current_user.id
    e.recorded_by_name = current_user.name or current_user.email
    e.work_date = work_date
    e.start_time = None
    e.end_time = None
    e.hours = float(body.hours)
    e.pay_structure = PTO_PAY_STRUCTURE
    e.pay_other_note = None
    e.notes = (body.notes or "").strip() or "Paid time off"
    e.updated_at = now

    db.commit()
    db.refresh(e)
    _export(e)
    return _to_out(e)


@admin_router.get("", response_model=List[OffJobOut])
def list_all_off_job(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(OffJobEntry).order_by(OffJobEntry.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]
