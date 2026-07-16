"""
Bill router.

Endpoints:
- GET  /api/bill/seed?job_uuid=...  - auto-populate line items from events + materials
- GET  /api/bill?job_uuid=...       - load saved bill (404 if none)
- POST /api/bill                    - upsert bill
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.event import Event
from app.db.models.job_bill import JobBill
from app.db.models.user import User
from app.integrations.sheets_export import export_bill_to_sheets, run_export_in_background

router = APIRouter(prefix="/api/bill", tags=["bill"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class BillUpsert(BaseModel):
    job_uuid: str
    items: List[Dict[str, Any]]
    global_discount: float = 0.0
    notes: Optional[str] = None


class BillResponse(BaseModel):
    id: int
    job_uuid: str
    items: List[Dict[str, Any]]
    global_discount: float
    notes: Optional[str]
    saved_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(b: JobBill) -> BillResponse:
    return BillResponse(
        id=b.id,
        job_uuid=b.job_uuid,
        items=json.loads(b.items_json or "[]"),
        global_discount=b.global_discount or 0.0,
        notes=b.notes,
        saved_by_name=b.saved_by_name,
        created_at=b.created_at,
        updated_at=b.updated_at,
    )


# ── Seed - auto-populate from events + materials ─────────────────────────────

@router.get("/seed")
def get_bill_seed(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return auto-populated line-item seed data from logged events and materials."""

    # ── Hours from start/finish events ────────────────────────────────────────
    # Each labor span needs only the EARLIEST start and the LATEST finish per
    # person per event type, so aggregate that in SQL with MIN/MAX grouped by
    # (person, type). This reads at most (people x event-types) rows instead of
    # every event for the job - bounded regardless of a retry storm, so no row
    # cap is needed, and (unlike an ordered .limit()) it can never truncate the
    # wrong end of a span. Mirrors `created_by or "Unknown"` / `(type or "").lower()`
    # from the old per-event scan via nullif+coalesce and lower.
    person_col = func.coalesce(func.nullif(Event.created_by, ""), "Unknown")
    type_col = func.lower(func.coalesce(Event.type, ""))
    agg_rows = (
        db.query(
            person_col.label("person"),
            type_col.label("etype"),
            func.min(Event.timestamp).label("first_ts"),
            func.max(Event.timestamp).label("last_ts"),
        )
        .filter(Event.job_uuid == job_uuid)
        .group_by(person_col, type_col)
        .all()
    )
    # (person, etype) -> (earliest_ts, latest_ts)
    spans: dict[tuple[str, str], tuple[datetime, datetime]] = {
        (r.person, r.etype): (r.first_ts, r.last_ts) for r in agg_rows
    }
    # Sorted for a stable line order (the old scan ordered by event time).
    people = sorted({p for (p, _et) in spans})

    def _span_lines(start_type: str, finish_type: str, label: str) -> list[dict]:
        out: list[dict] = []
        for person in people:
            st = spans.get((person, start_type))
            ft = spans.get((person, finish_type))
            if st and ft:
                start_ts, finish_ts = st[0], ft[1]  # earliest start, latest finish
                if finish_ts > start_ts:
                    hrs = round((finish_ts - start_ts).total_seconds() / 3600, 2)
                    out.append({"created_by": person, "label": label, "hours": hrs})
        return out

    # Local jobs use START/FINISH. Long-distance splits hourly labor into the
    # LOAD span + the UNLOAD span (kept separate so the multi-day drive between
    # them is NOT billed hourly - drive time is paid a fixed amount); those lines
    # only appear when the LOAD_/UNLOAD_ events exist.
    hours_lines = _span_lines("start", "finish", "Labor (per hour)")
    hours_lines += _span_lines("pack_start", "pack_finish", "Packing labor (per hour)")
    hours_lines += _span_lines("load_start", "load_finish", "Load labor (per hour)")
    hours_lines += _span_lines("unload_start", "unload_finish", "Unload labor (per hour)")
    hours_lines += _span_lines("unpack_start", "unpack_finish", "Unpacking labor (per hour)")

    # Materials are no longer seeded into the bill's line items - they live
    # in a dedicated live-shared panel inside the bill helper (see
    # /api/materials). Keep the field in the response for frontend compat.
    material_lines: list[dict] = []

    return {
        "hours_lines": hours_lines,
        "material_lines": material_lines,
    }


# ── Get saved bill ────────────────────────────────────────────────────────────

@router.get("")
def get_bill(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> BillResponse:
    bill = db.query(JobBill).filter(JobBill.job_uuid == job_uuid).first()
    if not bill:
        raise HTTPException(status_code=404, detail="No bill saved for this job")
    return _to_response(bill)


# ── Upsert bill ───────────────────────────────────────────────────────────────

def _export_bill(db: Session, bill: JobBill) -> None:
    payload = {
        "job_uuid": bill.job_uuid,
        "saved_by_name": bill.saved_by_name,
        "items": json.loads(bill.items_json or "[]"),
        "global_discount": bill.global_discount,
        "notes": bill.notes,
        "updated_at": bill.updated_at,
    }
    run_export_in_background(export_bill_to_sheets, payload)


@router.post("", response_model=BillResponse)
def upsert_bill(
    body: BillUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    existing = db.query(JobBill).filter(JobBill.job_uuid == body.job_uuid).first()

    if existing:
        existing.items_json = json.dumps(body.items)
        existing.global_discount = body.global_discount
        existing.notes = body.notes
        existing.saved_by_id = current_user.id
        existing.saved_by_name = current_user.name or current_user.email
        existing.updated_at = now
        db.commit()
        db.refresh(existing)
        _export_bill(db, existing)
        return _to_response(existing)

    bill = JobBill(
        job_uuid=body.job_uuid,
        items_json=json.dumps(body.items),
        global_discount=body.global_discount,
        notes=body.notes,
        saved_by_id=current_user.id,
        saved_by_name=current_user.name or current_user.email,
        created_at=now,
        updated_at=now,
    )
    db.add(bill)
    db.commit()
    db.refresh(bill)
    _export_bill(db, bill)
    return _to_response(bill)
