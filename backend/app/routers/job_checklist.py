"""
Job checklist status router (C3.2), crew-facing.

Two things the checklist UI needs for a job:
  - the live AUTO signals (has a pre-trip DVIR been filed, is the report saved,
    is the BOL signed, etc.), computed from the job's artifacts on read; and
  - the MANUAL tick state (trucks swept, gear accounted for), stored per job.

The template itself (which items exist, which signal each binds to) comes from
the public GET /api/config/job-checklist. This router only answers "for THIS
job, what is done".
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.bol import DigitalBOL
from app.db.models.dvir import DVIR
from app.db.models.event import Event
from app.db.models.job_checklist_check import JobChecklistCheck
from app.db.models.job_inventory import JobInventoryItem
from app.db.models.job_report import JobReport
from app.db.models.long_distance import PriorOnDutyStatement, RodsLog
from app.db.models.user import User

router = APIRouter(prefix="/api/job-checklist", tags=["job-checklist"])


def _job_signals(db: Session, job_uuid: str) -> Dict[str, bool]:
    """The AUTO signal booleans for a job. Keys match AUTO_SIGNALS in
    core/job_checklists.py - keep the two in sync."""
    def has(col, *filters) -> bool:
        return db.query(col).filter(*filters).first() is not None

    bol_statuses = {
        s for (s,) in db.query(DigitalBOL.status).filter(DigitalBOL.job_uuid == job_uuid).all()
    }
    return {
        "pretrip_dvir": has(DVIR.job_uuid, DVIR.job_uuid == job_uuid, DVIR.inspection_type == "pre-trip"),
        "posttrip_dvir": has(DVIR.job_uuid, DVIR.job_uuid == job_uuid, DVIR.inspection_type == "post-trip"),
        "job_report": has(JobReport.job_uuid, JobReport.job_uuid == job_uuid),
        "bol_origin_signed": bool(bol_statuses & {"origin_signed", "delivered"}),
        "bol_delivered": "delivered" in bol_statuses,
        "inventory": has(JobInventoryItem.job_uuid, JobInventoryItem.job_uuid == job_uuid),
        "weighed": has(Event.job_uuid, Event.job_uuid == job_uuid, Event.type == "WEIGHT"),
        "pods": has(PriorOnDutyStatement.job_uuid, PriorOnDutyStatement.job_uuid == job_uuid),
        "rods": has(RodsLog.job_uuid, RodsLog.job_uuid == job_uuid),
    }


@router.get("/{job_uuid}/status")
def get_status(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    checks = db.query(JobChecklistCheck).filter(JobChecklistCheck.job_uuid == job_uuid).all()
    return {
        "job_uuid": job_uuid,
        "signals": _job_signals(db, job_uuid),
        "manual": {c.item_key: bool(c.checked) for c in checks},
    }


class CheckIn(BaseModel):
    item_key: str
    checked: bool


@router.put("/{job_uuid}/check")
def set_check(
    job_uuid: str,
    body: CheckIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Set a MANUAL item's tick for a job. Idempotent by (job_uuid, item_key) so
    the offline queue can retry safely."""
    key = (body.item_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="item_key required")
    now = datetime.now(timezone.utc)
    row = (
        db.query(JobChecklistCheck)
        .filter(JobChecklistCheck.job_uuid == job_uuid, JobChecklistCheck.item_key == key)
        .first()
    )
    if row is None:
        row = JobChecklistCheck(job_uuid=job_uuid, item_key=key, updated_at=now)
        db.add(row)
    row.checked = bool(body.checked)
    row.checked_by_id = current_user.id
    row.checked_by_name = current_user.name or current_user.email
    row.updated_at = now
    db.commit()
    return {"item_key": key, "checked": bool(row.checked)}
