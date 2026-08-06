"""
Job setup (header) router - ADR 0034, C1.1.

The top-level job header: crew, vehicle unit(s), local/long-distance, job type,
addresses. Crew-facing and idempotent by job_uuid so the offline queue can retry
safely. This phase is additive: it stores and returns the header; wiring the
other tools to seed from it is a later phase (C1.3).

Overwrite protection (C2): a header can be `locked`, after which a write that
would change it is refused unless the caller passes `override`.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.job_setup import JobSetup
from app.db.models.user import User

router = APIRouter(prefix="/api/job-setup", tags=["job-setup"])


class CrewMember(BaseModel):
    user_id: Optional[int] = None
    name: str = ""
    source: str = "added"      # "invitee" | "added"
    confirmed: bool = True


class BolHeader(BaseModel):
    """The long-distance Bill of Lading shipment header the job header owns (ADR
    0034). All optional; each field seeds the BOL blank-only. These are the FMCSA
    375.505 fields not already on the job header - origin/destination live in their
    own columns, vehicle in vehicle_unit_names, and shipment_number is derived from
    the job name + date."""
    shipper_name: Optional[str] = None
    shipper_phone: Optional[str] = None
    shipper_address: Optional[str] = None
    form_of_payment: Optional[str] = None
    estimate_type: Optional[str] = None
    valuation: Optional[str] = None
    agreed_pickup: Optional[str] = None
    agreed_delivery: Optional[str] = None
    cod_notify: Optional[str] = None
    cod_max: Optional[str] = None
    additional_carriers: Optional[str] = None
    third_party_insurance: Optional[str] = None
    accessorial_services: Optional[str] = None


class JobSetupIn(BaseModel):
    job_name: Optional[str] = None
    job_date: Optional[str] = None
    source: Optional[str] = None
    calendar_event_id: Optional[str] = None
    is_long_distance: bool = False
    job_type_tags: List[str] = []
    vehicle_unit_names: List[str] = []
    crew: List[CrewMember] = []
    origin: Optional[str] = None
    destination: Optional[str] = None
    stops: List[str] = []
    bol_header: Optional[BolHeader] = None
    notes: Optional[str] = None
    locked: bool = False
    # Permission to overwrite a locked header (C2). Absent/false = refuse.
    override: bool = False


def _load_list(raw: Optional[str]) -> List[Any]:
    try:
        v = json.loads(raw or "[]")
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def _load_obj(raw: Optional[str]) -> Dict[str, Any]:
    try:
        v = json.loads(raw or "{}")
        return v if isinstance(v, dict) else {}
    except (ValueError, TypeError):
        return {}


def _to_out(row: JobSetup) -> Dict[str, Any]:
    return {
        "job_uuid": row.job_uuid,
        "job_name": row.job_name,
        "job_date": row.job_date,
        "source": row.source,
        "calendar_event_id": row.calendar_event_id,
        "is_long_distance": bool(row.is_long_distance),
        "job_type_tags": [str(t) for t in _load_list(row.job_type_tags)],
        "vehicle_unit_names": [str(u) for u in _load_list(row.vehicle_unit_names)],
        "crew": _load_list(row.crew_json),
        "origin": row.origin,
        "destination": row.destination,
        "stops": [str(s) for s in _load_list(row.stops_json)],
        "bol_header": _load_obj(row.bol_header_json),
        "notes": row.notes,
        "locked": bool(row.locked),
        "updated_by_name": row.updated_by_name,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/{job_uuid}")
def get_job_setup(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    row = db.query(JobSetup).filter(JobSetup.job_uuid == job_uuid).first()
    return {"job_uuid": job_uuid, "setup": _to_out(row) if row else None}


def _clean_crew(crew: List[CrewMember]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set = set()
    for c in crew:
        name = (c.name or "").strip()
        # Dedupe by user_id when present, else by lowercased name.
        key = ("id", c.user_id) if isinstance(c.user_id, int) else ("nm", name.lower())
        if not name and c.user_id is None:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "user_id": c.user_id if isinstance(c.user_id, int) else None,
            "name": name,
            "source": c.source if c.source in ("invitee", "added") else "added",
            "confirmed": bool(c.confirmed),
        })
    return out


@router.put("/{job_uuid}")
def upsert_job_setup(
    job_uuid: str,
    body: JobSetupIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    existing = db.query(JobSetup).filter(JobSetup.job_uuid == job_uuid).first()

    # Overwrite protection (C2): a locked header is only changed with an explicit
    # override, so a stray auto-save from another screen cannot clobber it.
    if existing is not None and existing.locked and not body.override:
        raise HTTPException(
            status_code=409,
            detail=(
                "This job's setup is locked. Unlock it to make changes so it is "
                "not overwritten by accident."
            ),
        )

    tags = json.dumps([str(t).strip() for t in body.job_type_tags if str(t).strip()])
    units = json.dumps([str(u).strip() for u in body.vehicle_unit_names if str(u).strip()])
    crew = json.dumps(_clean_crew(body.crew))
    stops = json.dumps([str(s).strip() for s in body.stops if str(s).strip()])
    bol = json.dumps(
        {k: (v.strip() if isinstance(v, str) and v.strip() else None)
         for k, v in (body.bol_header.model_dump().items() if body.bol_header else [])}
    )

    if existing is None:
        existing = JobSetup(job_uuid=job_uuid, created_at=now,
                            created_by_id=current_user.id,
                            created_by_name=current_user.name or current_user.email)
        db.add(existing)

    existing.job_name = (body.job_name or "").strip() or None
    existing.job_date = (body.job_date or "").strip() or None
    existing.source = (body.source or "").strip() or None
    existing.calendar_event_id = (body.calendar_event_id or "").strip() or None
    existing.is_long_distance = bool(body.is_long_distance)
    existing.job_type_tags = tags
    existing.vehicle_unit_names = units
    existing.crew_json = crew
    existing.origin = (body.origin or "").strip() or None
    existing.destination = (body.destination or "").strip() or None
    existing.stops_json = stops
    existing.bol_header_json = bol
    existing.notes = (body.notes or "").strip() or None
    existing.locked = bool(body.locked)
    existing.updated_by_id = current_user.id
    existing.updated_by_name = current_user.name or current_user.email
    existing.updated_at = now

    db.commit()
    db.refresh(existing)
    return {"job_uuid": job_uuid, "setup": _to_out(existing)}
