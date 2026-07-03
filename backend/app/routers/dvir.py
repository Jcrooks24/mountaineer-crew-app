from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.core.mailer import send_email
from app.core.security import create_mechanic_sign_token, decode_mechanic_sign_token
from app.db.models.dvir import DVIR
from app.db.models.system_config import SystemConfig
from app.db.models.user import User
from app.integrations.sheets_export import export_dvir_to_sheets, run_export_in_background
from app.schemas.dvir import (
    DVIRCreate,
    DVIRResponse,
    MechanicReviewResponse,
    MechanicSignatureEmailRequest,
    MechanicSignRequest,
)

router = APIRouter(prefix="/api/dvir", tags=["dvir"])

DEFAULT_UNITS = ["26INT", "24FR8", "16FORD"]
UNITS_CONFIG_KEY = "dvir_units"


def _needs_mechanic_review(d: DVIR) -> bool:
    # A DVIR needs mechanic review only if defects were noted. Satisfactory
    # inspections with no defects auto-clear and do not sit in the queue.
    if d.condition != "satisfactory":
        return True
    defects = json.loads(d.defects_json) if d.defects_json else []
    return len(defects) > 0


def _to_response(d: DVIR) -> DVIRResponse:
    defects = json.loads(d.defects_json) if d.defects_json else []
    return DVIRResponse(
        id=d.id,
        dvir_id=d.dvir_id,
        vehicle_number=d.vehicle_number,
        trailer_number=d.trailer_number,
        odometer=d.odometer,
        inspection_type=d.inspection_type,
        inspection_date=d.inspection_date,
        job_uuid=d.job_uuid,
        job_id=d.job_id,
        defects=defects,
        defect_notes=d.defect_notes,
        condition=d.condition,
        back_of_truck_confirmed=d.back_of_truck_confirmed,
        overnight_hold=d.overnight_hold,
        driver_id=d.driver_id,
        driver_name=d.driver_name,
        driver_signature=d.driver_signature,
        driver_signed_at=d.driver_signed_at,
        mechanic_id=d.mechanic_id,
        mechanic_name=d.mechanic_name,
        mechanic_signature=d.mechanic_signature,
        mechanic_signed_at=d.mechanic_signed_at,
        repairs_made=d.repairs_made,
        mechanic_notes=d.mechanic_notes,
        mechanic_signature_requested_at=d.mechanic_signature_requested_at,
        mechanic_signature_requested_email=d.mechanic_signature_requested_email,
        created_at=d.created_at,
        needs_mechanic_review=_needs_mechanic_review(d),
    )


def _apply_mechanic_signature(
    db: Session,
    dvir: DVIR,
    body: MechanicSignRequest,
    mechanic_user_id: Optional[int],
) -> DVIR:
    """Shared mechanic sign-off logic for both the in-person admin PATCH and
    the remote token-scoped submit. Validates the DVIR is sign-able, stamps
    the signature, and queues the mechanic-phase sheet export.

    Raises HTTPException(409) if already signed, (400) if no defects."""
    if dvir.mechanic_signature:
        raise HTTPException(status_code=409, detail="DVIR already signed by mechanic")
    if not _needs_mechanic_review(dvir):
        raise HTTPException(
            status_code=400,
            detail="DVIR has no defects - mechanic review is not required.",
        )

    dvir.mechanic_id = mechanic_user_id
    dvir.mechanic_name = body.mechanic_name
    dvir.mechanic_signature = body.mechanic_signature
    dvir.mechanic_signed_at = datetime.now(timezone.utc)
    dvir.repairs_made = body.repairs_made
    dvir.mechanic_notes = body.mechanic_notes
    db.commit()
    db.refresh(dvir)

    run_export_in_background(
        export_dvir_to_sheets, _to_response(dvir).model_dump(), phase="mechanic"
    )
    return dvir


# ── Vehicle units list (non-admin, crew read-only) ────────────────────────────

@router.get("/units")
def get_units(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    row = db.query(SystemConfig).filter(SystemConfig.key == UNITS_CONFIG_KEY).first()
    units = json.loads(row.value) if row and row.value else DEFAULT_UNITS
    return {"units": units}


# ── Latest DVIR for a specific vehicle (must come before /{dvir_id}) ─────────

@router.get("/latest-for-vehicle")
def latest_for_vehicle(
    vehicle_number: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Optional[DVIRResponse]:
    dvir = (
        db.query(DVIR)
        .filter(DVIR.vehicle_number == vehicle_number)
        .order_by(DVIR.created_at.desc())
        .first()
    )
    if not dvir:
        return None
    return _to_response(dvir)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", response_model=DVIRResponse, status_code=status.HTTP_201_CREATED)
def create_dvir(
    body: DVIRCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Idempotent: return existing if same dvir_id already submitted
    existing = db.query(DVIR).filter(DVIR.dvir_id == body.dvir_id).first()
    if existing:
        return _to_response(existing)

    dvir = DVIR(
        dvir_id=body.dvir_id,
        vehicle_number=body.vehicle_number,
        trailer_number=body.trailer_number,
        odometer=body.odometer,
        inspection_type=body.inspection_type,
        inspection_date=body.inspection_date,
        job_uuid=body.job_uuid,
        job_id=body.job_id,
        defects_json=json.dumps(body.defects) if body.defects else None,
        defect_notes=body.defect_notes,
        condition=body.condition,
        back_of_truck_confirmed=body.back_of_truck_confirmed,
        overnight_hold=body.overnight_hold,
        driver_id=current_user.id,
        driver_name=body.driver_name,
        driver_signature=body.driver_signature,
        driver_signed_at=body.driver_signed_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(dvir)
    db.commit()
    db.refresh(dvir)

    run_export_in_background(
        export_dvir_to_sheets, _to_response(dvir).model_dump(), phase="driver"
    )

    return _to_response(dvir)


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[DVIRResponse])
def list_dvirs(
    pending_only: bool = False,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(DVIR)
    if pending_only:
        # Only DVIRs with defects need mechanic review. Satisfactory/no-defect
        # inspections auto-clear and are excluded from the pending queue.
        q = q.filter(
            DVIR.mechanic_signature.is_(None),
            DVIR.condition != "satisfactory",
        )
    rows = (
        q.order_by(DVIR.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_to_response(d) for d in rows]


# ── Get single ────────────────────────────────────────────────────────────────

@router.get("/{dvir_id}", response_model=DVIRResponse)
def get_dvir(
    dvir_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")
    return _to_response(dvir)


# ── Mechanic sign-off (in-person, admin) ──────────────────────────────────────

@router.patch("/{dvir_id}/mechanic-sign", response_model=DVIRResponse)
def mechanic_sign(
    dvir_id: str,
    body: MechanicSignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")
    dvir = _apply_mechanic_signature(db, dvir, body, mechanic_user_id=current_user.id)
    return _to_response(dvir)


# ── Remote mechanic sign-off - email a link to a mechanic without an account ──

@router.post("/{dvir_id}/request-mechanic-signature", response_model=DVIRResponse)
def request_mechanic_signature(
    dvir_id: str,
    body: MechanicSignatureEmailRequest,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin-only: email a remote sign-off link to a mechanic. The mechanic
    opens the link, reviews the defect, and signs without an app account."""
    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")
    if dvir.mechanic_signature:
        raise HTTPException(status_code=409, detail="DVIR already signed by mechanic")
    if not _needs_mechanic_review(dvir):
        raise HTTPException(
            status_code=400,
            detail="DVIR has no defects - mechanic review is not required.",
        )

    mechanic_email = (body.mechanic_email or "").strip()
    if not mechanic_email or "@" not in mechanic_email:
        raise HTTPException(status_code=400, detail="A valid mechanic email is required.")

    token = create_mechanic_sign_token(dvir.dvir_id)
    frontend_url = os.getenv("FRONTEND_URL", "https://mountaineer-crew-app.vercel.app").rstrip("/")
    sign_link = f"{frontend_url}/mechanic-sign?token={token}"

    # Log the link so it's recoverable from Render logs even if email fails.
    print(f"[mechanic-sign] request for DVIR {dvir.dvir_id} ({dvir.vehicle_number}) → {sign_link}")

    defects = json.loads(dvir.defects_json) if dvir.defects_json else []
    defect_line = ", ".join(defects) if defects else "Defects noted"
    greeting = f"Hi{' ' + body.mechanic_name if body.mechanic_name else ''},"
    try:
        send_email(
            to_email=mechanic_email,
            subject=f"Mechanic sign-off needed - {dvir.vehicle_number} (DVIR {dvir.inspection_date})",
            text=(
                f"{greeting}\n\n"
                f"Mountaineer Moving needs a mechanic sign-off before vehicle "
                f"{dvir.vehicle_number} can return to service.\n\n"
                f"Inspection: {dvir.inspection_type} on {dvir.inspection_date}\n"
                f"Reported by: {dvir.driver_name}\n"
                f"Defects: {defect_line}\n"
                + (f"Notes: {dvir.defect_notes}\n" if dvir.defect_notes else "")
                + f"\nReview the inspection and sign off here (link expires in 14 days):\n\n"
                f"{sign_link}\n\n"
                f"Once you sign, the vehicle is automatically cleared for service."
            ),
        )
        # Log the dvir id rather than the mechanic's email - Render logs are
        # not the right place to record third-party contact information.
        print(f"[mechanic-sign] email sent OK for dvir {dvir.id}")
    except Exception as exc:
        print(f"[mechanic-sign] email send FAILED for dvir {dvir.id}: {exc}")
        raise HTTPException(
            status_code=502,
            detail="Could not send the signature request email. Try again.",
        )

    dvir.mechanic_signature_requested_at = datetime.now(timezone.utc)
    dvir.mechanic_signature_requested_email = mechanic_email
    db.commit()
    db.refresh(dvir)
    return _to_response(dvir)


@router.get("/mechanic-sign/review", response_model=MechanicReviewResponse)
def mechanic_sign_review(
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Public - no auth. Returns the DVIR a mechanic-sign token authorizes,
    so the remote sign page can show the inspection facts for review."""
    try:
        dvir_id = decode_mechanic_sign_token(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid or expired signature link")

    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")

    defects = json.loads(dvir.defects_json) if dvir.defects_json else []
    return MechanicReviewResponse(
        dvir_id=dvir.dvir_id,
        vehicle_number=dvir.vehicle_number,
        trailer_number=dvir.trailer_number,
        odometer=dvir.odometer,
        inspection_type=dvir.inspection_type,
        inspection_date=dvir.inspection_date,
        defects=defects,
        defect_notes=dvir.defect_notes,
        condition=dvir.condition,
        driver_name=dvir.driver_name,
        created_at=dvir.created_at,
        already_signed=bool(dvir.mechanic_signature),
        needs_mechanic_review=_needs_mechanic_review(dvir),
    )


@router.post("/mechanic-sign/submit", response_model=MechanicReviewResponse)
def mechanic_sign_submit(
    body: MechanicSignRequest,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """Public - no auth. A remote mechanic submits their signature via the
    token-scoped link. Applies the sign-off and auto-clears the vehicle."""
    try:
        dvir_id = decode_mechanic_sign_token(token)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid or expired signature link")

    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")

    dvir = _apply_mechanic_signature(db, dvir, body, mechanic_user_id=None)

    defects = json.loads(dvir.defects_json) if dvir.defects_json else []
    return MechanicReviewResponse(
        dvir_id=dvir.dvir_id,
        vehicle_number=dvir.vehicle_number,
        trailer_number=dvir.trailer_number,
        odometer=dvir.odometer,
        inspection_type=dvir.inspection_type,
        inspection_date=dvir.inspection_date,
        defects=defects,
        defect_notes=dvir.defect_notes,
        condition=dvir.condition,
        driver_name=dvir.driver_name,
        created_at=dvir.created_at,
        already_signed=True,
        needs_mechanic_review=False,
    )
