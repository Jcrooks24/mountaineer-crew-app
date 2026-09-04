"""
Reimbursement router.

Crew submits mileage or business-expense reimbursement requests with
photo evidence; admin approves on a separate endpoint. Photos upload to
Google Drive first; the resulting Drive ids/URLs are persisted on the
reimbursement row and round-tripped to the Reimbursements worksheet.

Two POSTs:
- /api/reimbursements/mileage   - multipart with two odometer photos
- /api/reimbursements/expense   - multipart with one receipt photo

Both are idempotent on reimbursement_uuid (offline retry path).
"""
from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.reimbursement import REIMBURSEMENT_STATUSES, Reimbursement
from app.db.models.user import User
from app.integrations.drive_upload import upload_reimbursement_photo_to_drive
from app.integrations.sheets_export import (
    export_reimbursement_to_sheets,
    run_export_in_background,
)

router = APIRouter(prefix="/api/reimbursements", tags=["reimbursements"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReimbursementOut(BaseModel):
    reimbursement_uuid: str
    user_name: str
    type: str
    job_uuid: Optional[str]
    job_name: Optional[str]
    job_date: Optional[str]
    expense_date: Optional[str]
    odometer_start: Optional[int]
    odometer_end: Optional[int]
    odometer_start_photo_url: Optional[str]
    odometer_end_photo_url: Optional[str]
    amount: Optional[float]
    category: Optional[str]
    vendor: Optional[str]
    receipt_photo_url: Optional[str]
    photos_drive_url: Optional[str]
    payment_method: Optional[str]
    notes: Optional[str]
    status: str
    approver_name: Optional[str]
    approved_at: Optional[datetime]
    approval_notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    # Payment (set when a payroll period that included this claim is finalized)
    # and QuickBooks entry are two different facts, tracked separately: a claim
    # can be paid and not yet keyed in, which is exactly the state the office
    # needs to see.
    paid_at: Optional[datetime] = None
    paid_period_start: Optional[str] = None
    paid_period_end: Optional[str] = None
    qb_status: str = "pending"
    qb_entered_at: Optional[datetime] = None
    qb_entered_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class ApprovalIn(BaseModel):
    status: str                       # "approved" or "rejected"
    approval_notes: Optional[str] = ""


def _to_out(row: Reimbursement) -> ReimbursementOut:
    return ReimbursementOut(
        reimbursement_uuid=row.reimbursement_uuid,
        user_name=row.user_name,
        type=row.type,
        job_uuid=row.job_uuid,
        job_name=row.job_name,
        job_date=row.job_date,
        expense_date=row.expense_date,
        odometer_start=row.odometer_start,
        odometer_end=row.odometer_end,
        odometer_start_photo_url=row.odometer_start_photo_url,
        odometer_end_photo_url=row.odometer_end_photo_url,
        amount=float(row.amount) if row.amount is not None else None,
        category=row.category,
        vendor=row.vendor,
        receipt_photo_url=row.receipt_photo_url,
        photos_drive_url=row.photos_drive_url,
        payment_method=row.payment_method,
        notes=row.notes,
        status=row.status,
        approver_name=row.approver_name,
        approved_at=row.approved_at,
        approval_notes=row.approval_notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
        paid_at=row.paid_at,
        paid_period_start=row.paid_period_start,
        paid_period_end=row.paid_period_end,
        qb_status=(row.qb_status or "pending"),
        qb_entered_at=row.qb_entered_at,
        qb_entered_by_name=row.qb_entered_by_name,
    )


def _row_to_export_dict(row: Reimbursement) -> dict:
    return {
        "reimbursement_uuid": row.reimbursement_uuid,
        "user_name": row.user_name,
        "type": row.type,
        "job_name": row.job_name or "",
        "job_date": row.job_date or "",
        "expense_date": row.expense_date or "",
        "odometer_start": row.odometer_start,
        "odometer_end": row.odometer_end,
        "odometer_start_photo_url": row.odometer_start_photo_url or "",
        "odometer_end_photo_url": row.odometer_end_photo_url or "",
        "amount": float(row.amount) if row.amount is not None else None,
        "category": row.category or "",
        "vendor": row.vendor or "",
        "receipt_photo_url": row.receipt_photo_url or "",
        "photos_drive_url": row.photos_drive_url or "",
        "payment_method": row.payment_method or "",
        "notes": row.notes or "",
        "status": row.status,
        "approver_name": row.approver_name or "",
        "approved_at": row.approved_at,
        "approval_notes": row.approval_notes or "",
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _queue_export(row: Reimbursement) -> None:
    run_export_in_background(export_reimbursement_to_sheets, _row_to_export_dict(row))


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[ReimbursementOut])
def list_reimbursements(
    all_users: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List reimbursements newest-first. Default scope is the caller's own.
    Admins can pass all_users=true to audit everyone."""
    q = db.query(Reimbursement)
    if all_users:
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
    else:
        q = q.filter(Reimbursement.user_id == current_user.id)
    rows = q.order_by(Reimbursement.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]


@router.post("/mileage", response_model=ReimbursementOut)
def submit_mileage(
    reimbursement_uuid: str = Form(...),
    odometer_start: Optional[int] = Form(default=None),
    odometer_end: Optional[int] = Form(default=None),
    job_uuid: str = Form(default=""),
    job_name: str = Form(default=""),
    job_date: str = Form(default=""),
    expense_date: str = Form(default=""),
    notes: str = Form(default=""),
    odometer_start_photo: Optional[UploadFile] = File(default=None),
    odometer_end_photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fields are intentionally all optional - crew can submit a partial
    # request (e.g. only one odometer photo) and the admin follows up.
    # The only sanity guard is a reading inversion, and only when both
    # numbers are actually present.
    if (
        odometer_start is not None
        and odometer_end is not None
        and odometer_end < odometer_start
    ):
        raise HTTPException(status_code=400, detail="End odometer must be >= start odometer")

    existing = (
        db.query(Reimbursement)
        .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
        .first()
    )
    if existing:
        # Offline retry of an already-submitted request - return existing row.
        return _to_out(existing)

    user_name = current_user.name or current_user.email or ""

    start_upload = None
    end_upload = None
    try:
        if odometer_start_photo is not None:
            start_upload = upload_reimbursement_photo_to_drive(
                db=db,
                file_obj=odometer_start_photo.file,
                filename=f"{reimbursement_uuid}-start",
                mime_type=odometer_start_photo.content_type or "image/jpeg",
                user_name=user_name,
                reimbursement_uuid=reimbursement_uuid,
                kind="odo_start",
                caption=f"Start odometer: {odometer_start if odometer_start is not None else '-'}",
            )
        if odometer_end_photo is not None:
            end_upload = upload_reimbursement_photo_to_drive(
                db=db,
                file_obj=odometer_end_photo.file,
                filename=f"{reimbursement_uuid}-end",
                mime_type=odometer_end_photo.content_type or "image/jpeg",
                user_name=user_name,
                reimbursement_uuid=reimbursement_uuid,
                kind="odo_end",
                caption=f"End odometer: {odometer_end if odometer_end is not None else '-'}",
            )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Photo upload failed: {e}")

    # Both odometer photos share one per-submission folder, so either
    # upload's folder_url is the link to where the pair lives.
    photos_folder = None
    if start_upload:
        photos_folder = start_upload.get("folder_url")
    elif end_upload:
        photos_folder = end_upload.get("folder_url")

    now = datetime.now(timezone.utc)
    row = Reimbursement(
        reimbursement_uuid=reimbursement_uuid,
        user_id=current_user.id,
        user_name=user_name,
        type="mileage",
        job_uuid=job_uuid or None,
        job_name=job_name or None,
        job_date=job_date or None,
        expense_date=expense_date or None,
        odometer_start=odometer_start,
        odometer_end=odometer_end,
        odometer_start_photo_drive_id=start_upload["file_id"] if start_upload else None,
        odometer_start_photo_url=start_upload["url"] if start_upload else None,
        odometer_end_photo_drive_id=end_upload["file_id"] if end_upload else None,
        odometer_end_photo_url=end_upload["url"] if end_upload else None,
        photos_drive_url=photos_folder,
        notes=notes or None,
        status="submitted",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        # Lost a race against another concurrent submit with the same uuid -
        # return whichever copy won.
        db.rollback()
        row = (
            db.query(Reimbursement)
            .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
            .first()
        )
        if not row:
            raise HTTPException(status_code=500, detail="Failed to save mileage request")
        return _to_out(row)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save mileage request")

    _queue_export(row)
    return _to_out(row)


@router.post("/expense", response_model=ReimbursementOut)
def submit_expense(
    reimbursement_uuid: str = Form(...),
    amount: Optional[float] = Form(default=None),
    category: str = Form(default=""),
    vendor: str = Form(default=""),
    payment_method: str = Form(default="personal"),
    job_uuid: str = Form(default=""),
    job_name: str = Form(default=""),
    job_date: str = Form(default=""),
    expense_date: str = Form(default=""),
    notes: str = Form(default=""),
    receipt_photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # All fields optional so a partial request can still be filed; only
    # reject a negative amount, which is never meaningful.
    if amount is not None and amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

    # Default to "personal" (reimbursement requested) for any unexpected value
    # so a malformed client can't strand a row in an unknown state.
    method = payment_method.strip().lower()
    if method not in ("personal", "company"):
        method = "personal"

    existing = (
        db.query(Reimbursement)
        .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
        .first()
    )
    if existing:
        return _to_out(existing)

    user_name = current_user.name or current_user.email or ""

    upload = None
    try:
        if receipt_photo is not None:
            upload = upload_reimbursement_photo_to_drive(
                db=db,
                file_obj=receipt_photo.file,
                filename=f"{reimbursement_uuid}-receipt",
                mime_type=receipt_photo.content_type or "image/jpeg",
                user_name=user_name,
                reimbursement_uuid=reimbursement_uuid,
                kind="receipt",
                caption=f"Receipt: ${amount:.2f}" if amount is not None else "Receipt",
            )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Photo upload failed: {e}")

    now = datetime.now(timezone.utc)
    row = Reimbursement(
        reimbursement_uuid=reimbursement_uuid,
        user_id=current_user.id,
        user_name=user_name,
        type="expense",
        job_uuid=job_uuid or None,
        job_name=job_name or None,
        job_date=job_date or None,
        expense_date=expense_date or None,
        amount=amount,
        category=category or None,
        vendor=vendor.strip() or None,
        receipt_photo_drive_id=upload["file_id"] if upload else None,
        receipt_photo_url=upload["url"] if upload else None,
        # A receipt is a single file - the file link is the photo location.
        photos_drive_url=upload["url"] if upload else None,
        payment_method=method,
        notes=notes or None,
        status="submitted",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        row = (
            db.query(Reimbursement)
            .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
            .first()
        )
        if not row:
            raise HTTPException(status_code=500, detail="Failed to save expense request")
        return _to_out(row)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save expense request")

    _queue_export(row)
    return _to_out(row)


QB_STATUSES = {"pending", "entered"}


class QbStatusIn(BaseModel):
    """Mark one claim as keyed into QuickBooks, or put it back."""
    qb_status: str


@router.get("/search", response_model=List[ReimbursementOut])
def search_reimbursements(
    user_id: Optional[int] = Query(default=None),
    type: Optional[str] = Query(default=None, description="mileage | expense"),
    status: Optional[str] = Query(default=None, description="submitted | approved | rejected"),
    qb_status: Optional[str] = Query(default=None, description="pending | entered"),
    payment_method: Optional[str] = Query(default=None, description="personal | company"),
    date_from: Optional[str] = Query(default=None, description="YYYY-MM-DD, on expense_date"),
    date_to: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None, description="matches vendor, category or notes"),
    limit: int = Query(default=200, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """The office's reimbursement and mileage ledger.

    Admin-only, and separate from the crew-facing list endpoint rather than
    bolted onto it with more flags: that one defaults to the caller's own rows
    and grows an admin escape hatch, which is the shape that eventually leaks
    somebody else's receipts. This one is admin from the first line.

    Every filter is optional and they compose. `limit` is capped because this
    table only grows.
    """
    query = db.query(Reimbursement)
    if user_id is not None:
        query = query.filter(Reimbursement.user_id == user_id)
    if type:
        query = query.filter(Reimbursement.type == type)
    if status:
        query = query.filter(Reimbursement.status == status)
    if qb_status:
        # Rows written before this column existed carry the server default, so
        # there is no NULL case to handle.
        query = query.filter(Reimbursement.qb_status == qb_status)
    if payment_method:
        query = query.filter(Reimbursement.payment_method == payment_method)
    if date_from:
        query = query.filter(Reimbursement.expense_date >= date_from)
    if date_to:
        query = query.filter(Reimbursement.expense_date <= date_to)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Reimbursement.vendor.ilike(like),
                Reimbursement.category.ilike(like),
                Reimbursement.notes.ilike(like),
                Reimbursement.user_name.ilike(like),
            )
        )
    rows = (
        query.order_by(Reimbursement.expense_date.desc(), Reimbursement.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_to_out(r) for r in rows]


@router.patch("/{reimbursement_uuid}/qb-status", response_model=ReimbursementOut)
def set_qb_status(
    reimbursement_uuid: str,
    body: QbStatusIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Mark a claim entered in QuickBooks, or put it back to pending.

    Reversible on purpose. The office marks these off by hand while working
    through a list, and a one-way flag turns a mis-click into a receipt that
    never gets entered - the exact failure this column exists to prevent.

    Who and when are recorded on the way to "entered" and cleared on the way
    back, so the stamp never describes a state the row is not in.
    """
    want = (body.qb_status or "").strip().lower()
    if want not in QB_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"qb_status must be one of {sorted(QB_STATUSES)}",
        )
    row = (
        db.query(Reimbursement)
        .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No such reimbursement.")

    row.qb_status = want
    if want == "entered":
        row.qb_entered_at = datetime.now(timezone.utc).replace(tzinfo=None)
        row.qb_entered_by_name = current_user.name or current_user.email
    else:
        row.qb_entered_at = None
        row.qb_entered_by_name = None
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.patch("/{reimbursement_uuid}/approve", response_model=ReimbursementOut)
def approve_reimbursement(
    reimbursement_uuid: str,
    body: ApprovalIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if body.status not in REIMBURSEMENT_STATUSES or body.status == "submitted":
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")
    row = (
        db.query(Reimbursement)
        .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Reimbursement not found")

    now = datetime.now(timezone.utc)
    row.status = body.status
    row.approver_id = current_user.id
    row.approver_name = current_user.name or current_user.email
    row.approved_at = now
    row.approval_notes = body.approval_notes or None
    row.updated_at = now
    try:
        db.commit()
        db.refresh(row)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update reimbursement")

    _queue_export(row)
    return _to_out(row)
