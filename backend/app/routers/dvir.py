from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.dvir import DVIR
from app.db.models.system_config import SystemConfig
from app.db.models.user import User
from app.schemas.dvir import DVIRCreate, DVIRResponse, MechanicSignRequest

router = APIRouter(prefix="/api/dvir", tags=["dvir"])

DEFAULT_UNITS = ["26INT", "24FR8", "16FORD"]
UNITS_CONFIG_KEY = "dvir_units"


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
        created_at=d.created_at,
    )


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
        driver_id=current_user.id,
        driver_name=body.driver_name,
        driver_signature=body.driver_signature,
        driver_signed_at=body.driver_signed_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(dvir)
    db.commit()
    db.refresh(dvir)
    return _to_response(dvir)


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[DVIRResponse])
def list_dvirs(
    pending_only: bool = False,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(DVIR)
    if pending_only:
        q = q.filter(DVIR.mechanic_signature.is_(None))
    return [_to_response(d) for d in q.order_by(DVIR.created_at.desc()).all()]


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


# ── Mechanic sign-off ─────────────────────────────────────────────────────────

@router.patch("/{dvir_id}/mechanic-sign", response_model=DVIRResponse)
def mechanic_sign(
    dvir_id: str,
    body: MechanicSignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dvir = db.query(DVIR).filter(DVIR.dvir_id == dvir_id).first()
    if not dvir:
        raise HTTPException(status_code=404, detail="DVIR not found")
    if dvir.mechanic_signature:
        raise HTTPException(status_code=409, detail="DVIR already signed by mechanic")

    dvir.mechanic_id = current_user.id
    dvir.mechanic_name = body.mechanic_name
    dvir.mechanic_signature = body.mechanic_signature
    dvir.mechanic_signed_at = datetime.now(timezone.utc)
    dvir.repairs_made = body.repairs_made
    dvir.mechanic_notes = body.mechanic_notes
    db.commit()
    db.refresh(dvir)
    return _to_response(dvir)
