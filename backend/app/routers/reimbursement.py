"""
Reimbursement router.

Crew submits mileage or business-expense reimbursement requests with
photo evidence; admin approves on a separate endpoint. Photos upload to
Google Drive first; the resulting Drive ids/URLs are persisted on the
reimbursement row and round-tripped to the Reimbursements worksheet.

Two POSTs:
- /api/reimbursements/mileage   — multipart with two odometer photos
- /api/reimbursements/expense   — multipart with one receipt photo

Both are idempotent on reimbursement_uuid (offline retry path).
"""
from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.reimbursement import (
    REIMBURSEMENT_STATUSES,
    REIMBURSEMENT_TYPES,
    Reimbursement,
)
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
    odometer_start: Optional[int]
    odometer_end: Optional[int]
    odometer_start_photo_url: Optional[str]
    odometer_end_photo_url: Optional[str]
    amount: Optional[float]
    category: Optional[str]
    receipt_photo_url: Optional[str]
    notes: Optional[str]
    status: str
    approver_name: Optional[str]
    approved_at: Optional[datetime]
    approval_notes: Optional[str]
    created_at: datetime
    updated_at: datetime

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
        odometer_start=row.odometer_start,
        odometer_end=row.odometer_end,
        odometer_start_photo_url=row.odometer_start_photo_url,
        odometer_end_photo_url=row.odometer_end_photo_url,
        amount=float(row.amount) if row.amount is not None else None,
        category=row.category,
        receipt_photo_url=row.receipt_photo_url,
        notes=row.notes,
        status=row.status,
        approver_name=row.approver_name,
        approved_at=row.approved_at,
        approval_notes=row.approval_notes,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _row_to_export_dict(row: Reimbursement) -> dict:
    return {
        "reimbursement_uuid": row.reimbursement_uuid,
        "user_name": row.user_name,
        "type": row.type,
        "job_name": row.job_name or "",
        "job_date": row.job_date or "",
        "odometer_start": row.odometer_start,
        "odometer_end": row.odometer_end,
        "odometer_start_photo_url": row.odometer_start_photo_url or "",
        "odometer_end_photo_url": row.odometer_end_photo_url or "",
        "amount": float(row.amount) if row.amount is not None else None,
        "category": row.category or "",
        "receipt_photo_url": row.receipt_photo_url or "",
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
    notes: str = Form(default=""),
    odometer_start_photo: Optional[UploadFile] = File(default=None),
    odometer_end_photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fields are intentionally all optional — crew can submit a partial
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
        # Offline retry of an already-submitted request — return existing row.
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
                caption=f"Start odometer: {odometer_start if odometer_start is not None else '—'}",
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
                caption=f"End odometer: {odometer_end if odometer_end is not None else '—'}",
            )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Photo upload failed: {e}")

    now = datetime.now(timezone.utc)
    row = Reimbursement(
        reimbursement_uuid=reimbursement_uuid,
        user_id=current_user.id,
        user_name=user_name,
        type="mileage",
        job_uuid=job_uuid or None,
        job_name=job_name or None,
        job_date=job_date or None,
        odometer_start=odometer_start,
        odometer_end=odometer_end,
        odometer_start_photo_drive_id=start_upload["file_id"] if start_upload else None,
        odometer_start_photo_url=start_upload["url"] if start_upload else None,
        odometer_end_photo_drive_id=end_upload["file_id"] if end_upload else None,
        odometer_end_photo_url=end_upload["url"] if end_upload else None,
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
        # Lost a race against another concurrent submit with the same uuid —
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
    job_uuid: str = Form(default=""),
    job_name: str = Form(default=""),
    job_date: str = Form(default=""),
    notes: str = Form(default=""),
    receipt_photo: Optional[UploadFile] = File(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # All fields optional so a partial request can still be filed; only
    # reject a negative amount, which is never meaningful.
    if amount is not None and amount < 0:
        raise HTTPException(status_code=400, detail="Amount cannot be negative")

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
        amount=amount,
        category=category or None,
        receipt_photo_drive_id=upload["file_id"] if upload else None,
        receipt_photo_url=upload["url"] if upload else None,
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


# Re-export type constant so the frontend can stay in sync via the OpenAPI
# schema. Not strictly needed since types are duplicated in the TS side, but
# keeps the symbol referenced so a future enum tightening propagates.
__all__ = ["router", "REIMBURSEMENT_TYPES"]
