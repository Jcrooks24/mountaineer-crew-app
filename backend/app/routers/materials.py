import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, model_validator
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.materials import MaterialsSubmission
from app.integrations.sheets_export import export_materials_to_sheets
from app.core.deps import get_current_user
from app.db.models.user import User

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
    job_label: Optional[str] = ""
    job_name: Optional[str] = ""
    job_date: Optional[str] = ""
    notes: Optional[str] = ""
    items: List[Dict[str, Any]]      # list of MaterialLineItem objects
    total: float

    @model_validator(mode="before")
    @classmethod
    def _normalize_camel(cls, v: Any) -> Any:
        """Accept camelCase keys from the frontend as well as snake_case."""
        if isinstance(v, dict):
            for camel, snake in (("jobLabel", "job_label"), ("jobName", "job_name"), ("jobDate", "job_date")):
                if camel in v and snake not in v:
                    v[snake] = v.pop(camel)
                else:
                    v.pop(camel, None)
        return v


@router.post("")
def submit_materials(payload: MaterialsSubmissionIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Store a materials submission and export to Google Sheets.
    Idempotent — duplicate submission_id is silently ignored.
    """
    try:
        ts = datetime.fromisoformat(payload.created_at.replace("Z", "+00:00"))
    except Exception:
        ts = datetime.utcnow()

    job_label = payload.job_label or ""
    job_name = payload.job_name or ""
    job_date = payload.job_date or ""

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
    except SQLAlchemyError:
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
    job_uuid: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return materials submissions newest-first. If job_uuid is provided,
    returns only submissions for that job.
    """
    q = db.query(MaterialsSubmission)
    if job_uuid:
        q = q.filter(MaterialsSubmission.job_uuid == job_uuid)
    rows = q.order_by(MaterialsSubmission.created_at.desc()).limit(limit).all()
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


@router.delete("/{submission_id}")
def delete_material(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single materials submission (used to remove one item from
    the live per-job materials list). Idempotent — returns ok even if absent."""
    row = (
        db.query(MaterialsSubmission)
        .filter(MaterialsSubmission.submission_id == submission_id)
        .first()
    )
    if row is None:
        return {"ok": True, "deleted": False}
    db.delete(row)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete material")
    return {"ok": True, "deleted": True}
