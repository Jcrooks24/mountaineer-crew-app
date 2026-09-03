import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, model_validator
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.materials import MaterialsSubmission
from app.integrations.sheets_export import (
    delete_materials_from_sheets,
    export_materials_to_sheets,
    run_export_in_background,
    schedule_job_materials_bills_rebuild,
)
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
    Idempotent - duplicate submission_id is silently ignored.
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
        # Duplicate submission_id - the row is already in the DB from an
        # earlier successful POST. Common on the offline retry path: the
        # first POST committed but the response never made it back to the
        # device, so the queue retries with the same id.
        db.rollback()
        inserted = False
    except SQLAlchemyError:
        db.rollback()
        inserted = False

    # Always queue the sheet exports, even when inserted=False. The exports
    # are idempotent (Materials sheet dedupes per submission_id:item_id;
    # Bills sheet replaces by submission_id), so a re-run can't double-write.
    # Crucially, this gives previously-failed exports another shot - the
    # original code skipped re-export on inserted=False, which permanently
    # stranded any submission whose first export attempt died (e.g. during
    # the SSL race that crashed the worker mid-export).
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
    # Materials worksheet: itemized one row per line item.
    run_export_in_background(export_materials_to_sheets, submission_dict)
    # Bills worksheet: ONE aggregate row per job representing the running
    # materials total, refreshed on every add. Re-summed from the DB so the
    # value is always correct regardless of what order POSTs/DELETES land in.
    # Scheduled, not fired directly: a draining offline queue sends several of
    # these for one job at once and they would race into two Materials lines.
    schedule_job_materials_bills_rebuild(payload.job_uuid, db)
    print(
        f"[materials] queued sheet export submission_id={payload.id} "
        f"job_uuid={payload.job_uuid} inserted={inserted} items={len(payload.items)}"
    )

    return {
        "ok": True,
        "inserted": inserted,
        "sheets_exported": None,
        "sheets_error": None,
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

    Streams the response and splices `items_json` through as raw JSON
    instead of parse/reserialize - the per-row dict tree was the peak
    memory pressure when concurrent fetches stacked on the 512MB worker.
    """
    q = db.query(MaterialsSubmission)
    if job_uuid:
        q = q.filter(MaterialsSubmission.job_uuid == job_uuid)
    rows = q.order_by(MaterialsSubmission.created_at.desc()).limit(limit).all()

    def gen():
        yield b'{"ok":true,"submissions":['
        first = True
        for r in rows:
            base = {
                "id": r.submission_id,
                "created_at": r.created_at.isoformat(),
                "job_uuid": r.job_uuid,
                "job_label": r.job_label or "",
                "job_name": r.job_name or "",
                "job_date": r.job_date or "",
                "notes": r.notes or "",
                "total": float(r.total) if r.total is not None else 0,
            }
            base_str = json.dumps(base)
            items_str = r.items_json or "[]"
            chunk = base_str[:-1] + ',"items":' + items_str + "}"
            yield (b"," if not first else b"") + chunk.encode("utf-8")
            first = False
        yield b"]}"

    return StreamingResponse(gen(), media_type="application/json")


@router.delete("/{submission_id}")
def delete_material(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single materials submission (used to remove one item from
    the live per-job materials list). Idempotent - returns ok even if absent."""
    row = (
        db.query(MaterialsSubmission)
        .filter(MaterialsSubmission.submission_id == submission_id)
        .first()
    )
    # Capture job_uuid before the delete commits - needed to recompute the
    # Bills aggregate row even if no DB row remains here (offline retry path).
    job_uuid = row.job_uuid if row is not None else ""

    deleted = False
    if row is not None:
        db.delete(row)
        try:
            db.commit()
            deleted = True
        except SQLAlchemyError:
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to delete material")

    # Mirror the removal to the Materials sheet (drops the row(s) for this
    # submission), then refresh the Bills aggregate so its "Materials" total
    # reflects the new sum. delete_materials_from_sheets is a no-op when the
    # sheet has no matching rows; the rebuild is skipped when no job_uuid is
    # known, and coalesced per job when one is.
    run_export_in_background(delete_materials_from_sheets, submission_id)
    if job_uuid:
        schedule_job_materials_bills_rebuild(job_uuid, db)
    print(
        f"[materials] queued sheet delete submission_id={submission_id} "
        f"job_uuid={job_uuid} db_row_deleted={deleted}"
    )

    return {"ok": True, "deleted": deleted}
