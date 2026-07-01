"""
Digital Bill of Lading router — /api/bol.

The crew builds a BOL's declared inventory in the field and submits it. This
endpoint is an UPSERT keyed by bol_id (device UUID): the same BOL is POSTed
again as per-item photo Drive links finish uploading (and, in Push 2, as
origin/destination signatures are captured), so a re-POST must update the
existing row rather than error or duplicate. Every write re-exports to Google
Sheets with a replace strategy (delete-before-write), so re-submits never
accumulate rows.

Mirrors the materials / long-distance idempotency pattern; the export is fired
on the bounded background pool so a slow Google call never blocks the request.
"""

import json
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, model_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.bol import DigitalBOL
from app.integrations.sheets_export import export_bol_to_sheets, run_export_in_background
from app.integrations.drive_upload import upload_bol_pdf_to_drive
from app.core.deps import get_current_user
from app.db.models.user import User

router = APIRouter(prefix="/api/bol", tags=["bol"])


class BOLIn(BaseModel):
    id: str                                  # device-generated UUID (bol_id)
    created_at: str                          # ISO datetime string
    job_uuid: Optional[str] = ""
    job_name: Optional[str] = ""
    job_date: Optional[str] = ""
    status: Optional[str] = "draft"
    carrier: Optional[Dict[str, Any]] = None      # static carrier block
    shipment: Optional[Dict[str, Any]] = None      # autofilled shipment details
    items: List[Dict[str, Any]] = []               # list of BOL items

    @model_validator(mode="before")
    @classmethod
    def _normalize_camel(cls, v: Any) -> Any:
        """Accept camelCase keys from the frontend as well as snake_case."""
        if isinstance(v, dict):
            for camel, snake in (("jobName", "job_name"), ("jobDate", "job_date"), ("jobUuid", "job_uuid")):
                if camel in v and snake not in v:
                    v[snake] = v.pop(camel)
                else:
                    v.pop(camel, None)
        return v


def _to_dict(row: DigitalBOL) -> Dict[str, Any]:
    """Serialize a BOL row for the API response and the sheets export.
    items_json is spliced through as parsed JSON. Raw signature data URLs are
    NOT returned (bandwidth) — only booleans + timestamps so a second device
    reopening at destination can see that origin was already signed."""
    try:
        items = json.loads(row.items_json or "[]")
    except Exception:
        items = []
    try:
        shipment = json.loads(row.shipment_json) if row.shipment_json else {}
    except Exception:
        shipment = {}
    return {
        "id": row.bol_id,
        "bol_id": row.bol_id,
        "created_by": row.created_by or "",
        "job_uuid": row.job_uuid or "",
        "job_name": row.job_name or "",
        "job_date": row.job_date or "",
        "status": row.status or "draft",
        "items": items,
        "shipment": shipment,
        "origin_signed": bool(row.origin_shipper_sig or row.origin_carrier_sig),
        "destination_signed": bool(row.dest_shipper_sig or row.dest_carrier_sig),
        "origin_signed_at": row.origin_signed_at.isoformat() if row.origin_signed_at else "",
        "dest_signed_at": row.dest_signed_at.isoformat() if row.dest_signed_at else "",
        "walkthrough_notes": row.walkthrough_notes or "",
        "final_charges": float(row.final_charges) if row.final_charges is not None else None,
        "signed_pdf_url": row.signed_pdf_url or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


@router.post("")
def submit_bol(
    payload: BOLIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update a Digital BOL, then export to Google Sheets.

    Idempotent upsert by bol_id — a re-POST (offline retry, or a re-submit to
    backfill photo Drive links) updates the existing row in place.
    """
    try:
        ts = datetime.fromisoformat(payload.created_at.replace("Z", "+00:00"))
    except Exception:
        ts = datetime.now(timezone.utc)

    now = datetime.now(timezone.utc)
    created_by = current_user.name or current_user.email or ""
    status = payload.status if payload.status in ("draft", "origin_signed", "delivered") else "draft"

    row = db.query(DigitalBOL).filter(DigitalBOL.bol_id == payload.id).first()
    if row is None:
        row = DigitalBOL(
            bol_id=payload.id,
            created_by=created_by,
            driver_id=current_user.id,
            job_uuid=payload.job_uuid or "",
            job_name=payload.job_name or "",
            job_date=payload.job_date or "",
            status=status,
            carrier_json=json.dumps(payload.carrier) if payload.carrier else None,
            shipment_json=json.dumps(payload.shipment) if payload.shipment else None,
            items_json=json.dumps(payload.items or []),
            created_at=ts,
            updated_at=now,
        )
        db.add(row)
    else:
        # Upsert — refresh the mutable fields. created_by / created_at / driver
        # stay as first written so the record of who started it is preserved.
        row.job_uuid = payload.job_uuid or row.job_uuid
        row.job_name = payload.job_name or row.job_name
        row.job_date = payload.job_date or row.job_date
        row.status = status
        if payload.carrier is not None:
            row.carrier_json = json.dumps(payload.carrier)
        if payload.shipment is not None:
            row.shipment_json = json.dumps(payload.shipment)
        row.items_json = json.dumps(payload.items or [])
        row.updated_at = now

    try:
        db.commit()
        db.refresh(row)
    except SQLAlchemyError:
        db.rollback()
        return {"ok": False, "error": "Failed to save BOL"}

    bol_dict = _to_dict(row)
    run_export_in_background(export_bol_to_sheets, bol_dict)
    print(
        f"[bol] saved bol_id={row.bol_id} job_uuid={row.job_uuid} "
        f"status={row.status} items={len(bol_dict['items'])}"
    )

    return {"ok": True, "bol": bol_dict}


@router.get("")
def get_bols(
    job_uuid: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return BOLs newest-first. If job_uuid is provided, only that job's BOLs
    (used to reopen a BOL from another device / later signing session)."""
    q = db.query(DigitalBOL)
    if job_uuid:
        q = q.filter(DigitalBOL.job_uuid == job_uuid)
    rows = q.order_by(DigitalBOL.created_at.desc()).limit(limit).all()
    return {"ok": True, "bols": [_to_dict(r) for r in rows]}


class BOLSignIn(BaseModel):
    phase: str                               # "origin" | "destination"
    shipper_sig: str                         # base64 PNG data URL
    carrier_sig: str                         # base64 PNG data URL
    signed_at: Optional[str] = None
    # origin extras (stored in shipment_json)
    actual_pickup_date: Optional[str] = None
    vehicle: Optional[str] = None
    # destination extras
    walkthrough_notes: Optional[str] = None
    final_charges: Optional[float] = None


@router.patch("/{bol_id}/sign")
def sign_bol(
    bol_id: str,
    payload: BOLSignIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Apply a signing session (origin or destination) to a BOL. Mirrors DVIR's
    two-signatory flow: origin (shipper + carrier rep before loading), then
    destination (shipper + carrier rep on delivery). Signatures are base64 PNG
    data URLs, stored alongside the record."""
    row = db.query(DigitalBOL).filter(DigitalBOL.bol_id == bol_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="BOL not found")

    try:
        ts = datetime.fromisoformat((payload.signed_at or "").replace("Z", "+00:00")) if payload.signed_at else datetime.now(timezone.utc)
    except Exception:
        ts = datetime.now(timezone.utc)

    if payload.phase == "origin":
        row.origin_shipper_sig = payload.shipper_sig
        row.origin_carrier_sig = payload.carrier_sig
        row.origin_signed_at = ts
        row.status = "origin_signed"
        try:
            shipment = json.loads(row.shipment_json) if row.shipment_json else {}
        except Exception:
            shipment = {}
        if payload.actual_pickup_date:
            shipment["actual_pickup_date"] = payload.actual_pickup_date
        if payload.vehicle:
            shipment["vehicle"] = payload.vehicle
        row.shipment_json = json.dumps(shipment)
    elif payload.phase == "destination":
        row.dest_shipper_sig = payload.shipper_sig
        row.dest_carrier_sig = payload.carrier_sig
        row.dest_signed_at = ts
        if payload.walkthrough_notes is not None:
            row.walkthrough_notes = payload.walkthrough_notes
        if payload.final_charges is not None:
            row.final_charges = payload.final_charges
        row.status = "delivered"
    else:
        raise HTTPException(status_code=400, detail="phase must be 'origin' or 'destination'")

    row.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
        db.refresh(row)
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save signatures")

    bol_dict = _to_dict(row)
    run_export_in_background(export_bol_to_sheets, bol_dict)
    print(f"[bol] signed bol_id={row.bol_id} phase={payload.phase} status={row.status}")
    return {"ok": True, "bol": bol_dict}


@router.post("/{bol_id}/pdf")
def upload_bol_pdf(
    bol_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store the on-device-generated signed BOL PDF in its own Drive folder
    (named "<date> - <Job Name>.pdf") and record the link. Idempotent-ish: a
    re-upload just points signed_pdf_url at the newest file."""
    row = db.query(DigitalBOL).filter(DigitalBOL.bol_id == bol_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="BOL not found")

    try:
        result = upload_bol_pdf_to_drive(
            db=db,
            file_obj=file.file,
            job_name=row.job_name or "",
            job_date=row.job_date or "",
        )
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "error": str(e)}

    row.signed_pdf_drive_id = result["file_id"]
    row.signed_pdf_url = result["url"]
    row.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
        db.refresh(row)
    except SQLAlchemyError:
        db.rollback()
        return {"ok": False, "error": "Failed to save PDF link"}

    run_export_in_background(export_bol_to_sheets, _to_dict(row))
    print(f"[bol] pdf uploaded bol_id={row.bol_id} url={row.signed_pdf_url}")
    return {"ok": True, "drive_url": result["url"]}
