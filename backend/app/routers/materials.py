import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.materials import MaterialsSubmission
from app.integrations.sheets_export import export_materials_to_sheets

router = APIRouter(prefix="/api/materials", tags=["materials"])


class MaterialLineItem(BaseModel):
    id: str
    name: str
    qty: float
    unitPrice: Optional[float] = None
    source: str
    baseCost: Optional[float] = None


class MaterialsSubmissionIn(BaseModel):
    id: str                          # device-generated UUID
    created_at: str                  # ISO datetime string
    job_uuid: str
    jobLabel: Optional[str] = ""
    job_label: Optional[str] = ""
    jobName: Optional[str] = ""
    job_name: Optional[str] = ""
    jobDate: Optional[str] = ""
    job_date: Optional[str] = ""
    notes: Optional[str] = ""
    items: List[Dict[str, Any]]      # list of MaterialLineItem objects
    total: float


@router.post("")
def submit_materials(payload: MaterialsSubmissionIn, db: Session = Depends(get_db)):
    """
    Store a materials submission and export to Google Sheets.
    Idempotent — duplicate submission_id is silently ignored.
    """
    try:
        ts = datetime.fromisoformat(payload.created_at.replace("Z", "+00:00"))
    except Exception:
        ts = datetime.utcnow()

    job_label = payload.jobLabel or payload.job_label or ""
    job_name = payload.jobName or payload.job_name or ""
    job_date = payload.jobDate or payload.job_date or ""

    row = MaterialsSubmission(
        submission_id=payload.id,
        created_at=ts,
        job_uuid=payload.job_uuid,
        job_label=job_label,
        job_name=job_name,
        job_date=job_date,
        notes=payload.notes or "",
        items_json=json.dumps(payload.items),
        total=payload.total,
    )

    db.add(row)
    try:
        db.commit()
        inserted = True
    except IntegrityError:
        db.rollback()
        inserted = False

    # Export to Google Sheets (non-blocking — don't fail the submission)
    sheets_exported = 0
    sheets_error = None
    try:
        submission_dict = {
            "id": payload.id,
            "created_at": payload.created_at,
            "job_uuid": payload.job_uuid,
            "jobName": job_name,
            "jobLabel": job_label,
            "jobDate": job_date,
            "notes": payload.notes or "",
            "items": payload.items,
            "total": payload.total,
        }
        sheets_exported = export_materials_to_sheets(db, submission_dict)
    except Exception as ex:
        sheets_error = str(ex)

    return {
        "ok": True,
        "inserted": inserted,
        "sheets_exported": sheets_exported,
        "sheets_error": sheets_error,
    }


@router.get("")
def get_materials(
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """
    Return all materials submissions newest-first.
    Used by devices on startup to restore history.
    """
    rows = (
        db.query(MaterialsSubmission)
        .order_by(MaterialsSubmission.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "ok": True,
        "submissions": [
            {
                "id": r.submission_id,
                "created_at": r.created_at.isoformat(),
                "job_uuid": r.job_uuid,
                "job_label": r.job_label or "",
                "job_name": r.job_name or "",
                "job_date": r.job_date or "",
                "notes": r.notes or "",
                "items": json.loads(r.items_json or "[]"),
                "total": r.total,
            }
            for r in rows
        ],
    }
