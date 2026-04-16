"""
Bill router.

Endpoints:
- GET  /api/bill/seed?job_uuid=...  — auto-populate line items from events + materials
- GET  /api/bill?job_uuid=...       — load saved bill (404 if none)
- POST /api/bill                    — upsert bill
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.event import Event
from app.db.models.job_bill import JobBill
from app.db.models.user import User

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


# ── Seed — auto-populate from events + materials ─────────────────────────────

@router.get("/seed")
def get_bill_seed(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return auto-populated line-item seed data from logged events and materials."""

    # ── Hours from start/finish events ────────────────────────────────────────
    events = (
        db.query(Event)
        .filter(Event.job_uuid == job_uuid)
        .order_by(Event.timestamp)
        .all()
    )

    # Group by created_by; track earliest start and latest finish per person
    starts: dict[str, datetime] = {}
    finishes: dict[str, datetime] = {}
    for e in events:
        person = e.created_by or "Unknown"
        etype = (e.type or "").lower()
        if etype == "start":
            if person not in starts:
                starts[person] = e.timestamp
        elif etype == "finish":
            finishes[person] = e.timestamp  # keep latest

    hours_lines = []
    for person, start_ts in starts.items():
        if person in finishes:
            finish_ts = finishes[person]
            if finish_ts > start_ts:
                hours = round((finish_ts - start_ts).total_seconds() / 3600, 2)
                hours_lines.append({
                    "created_by": person,
                    "label": f"Labor – {person}",
                    "hours": hours,
                })

    # Materials are no longer seeded into the bill's line items — they live
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
    return _to_response(bill)
