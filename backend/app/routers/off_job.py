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

# "pto" is paid time off. It is a pay structure rather than a separate feature
# because that is how the crew already think about an off-job day: they log the
# hours and say how they are paid. It is the only one with a cap (app/core/pto.py).
PAY_STRUCTURES = {"regular", "non_billable", "other", PTO_PAY_STRUCTURE}


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

    pay = body.pay_structure if body.pay_structure in PAY_STRUCTURES else "regular"

    # PTO spends a finite allowance, so it is the one entry the app refuses.
    # Checked here rather than only in the UI: the offline queue posts whatever
    # it was holding, possibly days later, and a client that was out of date
    # about somebody's balance must not be able to overspend it.
    #
    # The entry's own uuid is excluded from the "used" figure so that EDITING an
    # existing PTO entry is judged on the change, not on the old value plus the
    # new one - otherwise lowering 8 hours to 4 would be refused for exceeding a
    # cap the 8 had already filled.
    if pay == PTO_PAY_STRUCTURE:
        why = check_pto_allowed(
            db, current_user, (body.work_date or "").strip() or None,
            float(body.hours), exclude_entry_uuid=body.entry_uuid.strip(),
        )
        if why:
            raise HTTPException(status_code=400, detail=why)

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


@router.get("/pto-balance")
def my_pto_balance(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This crew member's PTO position for a calendar year (default: this one).

    Drives the Off Job screen: whether to offer PTO at all, and how much is left.
    The server checks the same thing again on submit - this is so the crew member
    is told before they type, not so the rule lives on the client.
    """
    from datetime import date as _date
    return pto_balance(db, current_user, year or _date.today().year)


@router.get("", response_model=List[OffJobOut])
def list_my_off_job(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(OffJobEntry)
        .filter(OffJobEntry.submitted_by_id == current_user.id)
        .order_by(OffJobEntry.created_at.desc())
        .limit(100)
        .all()
    )
    return [_to_out(r) for r in rows]


@admin_router.get("", response_model=List[OffJobOut])
def list_all_off_job(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(OffJobEntry).order_by(OffJobEntry.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]
