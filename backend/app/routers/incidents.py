"""
Incidents router.

Crew submit incidents from the job flow (JSON, idempotent by incident_uuid so
the offline queue can safely retry). Admin reads the full log. Each write is
mirrored to the Incidents sheet tab.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.incident import Incident
from app.db.models.user import User
from app.integrations.sheets_export import export_incident_to_sheets, run_export_in_background


router = APIRouter(prefix="/api/incidents", tags=["incidents"])
admin_router = APIRouter(prefix="/api/admin/incidents", tags=["incidents"])

SEVERITIES = {"minor", "moderate", "major"}
ATTRIBUTABLE = {"yes", "no", "unknown"}


class IncidentIn(BaseModel):
    incident_uuid: str
    claim_number: Optional[str] = None
    job_uuid: Optional[str] = None
    job_name: Optional[str] = None
    incident_date: Optional[str] = None
    attributed_crew: Optional[str] = None
    severity: str = "minor"
    attributable: str = "unknown"
    description: str = ""
    est_cost: Optional[float] = None
    resolved: bool = False
    notes: Optional[str] = None
    photo_urls: List[str] = []


class IncidentOut(BaseModel):
    id: int
    incident_uuid: str
    claim_number: Optional[str] = None
    job_uuid: Optional[str] = None
    job_name: Optional[str] = None
    incident_date: Optional[str] = None
    reported_by_name: Optional[str] = None
    attributed_crew: Optional[str] = None
    severity: str
    attributable: str
    description: str
    est_cost: Optional[float] = None
    resolved: bool
    notes: Optional[str] = None
    photo_urls: List[str] = []
    created_at: str


def _to_out(inc: Incident) -> IncidentOut:
    try:
        urls = json.loads(inc.photo_urls or "[]")
        urls = [str(u) for u in urls] if isinstance(urls, list) else []
    except (ValueError, TypeError):
        urls = []
    return IncidentOut(
        id=inc.id,
        incident_uuid=inc.incident_uuid,
        claim_number=inc.claim_number,
        job_uuid=inc.job_uuid,
        job_name=inc.job_name,
        incident_date=inc.incident_date,
        reported_by_name=inc.reported_by_name,
        attributed_crew=inc.attributed_crew,
        severity=inc.severity,
        attributable=inc.attributable,
        description=inc.description or "",
        est_cost=inc.est_cost,
        resolved=bool(inc.resolved),
        notes=inc.notes,
        photo_urls=urls,
        created_at=inc.created_at.isoformat() if inc.created_at else "",
    )


def _export(inc: Incident) -> None:
    run_export_in_background(export_incident_to_sheets, _to_out(inc).model_dump())


def export_incident_by_uuid(db: Session, incident_uuid: str) -> None:
    """Re-export one incident to the sheet by uuid. Called from the photo upload
    route when a photo is tagged to an incident: the incident row carries a
    photo_urls column, and photos are almost always attached *after* the incident
    is filed, so without this the sheet's photo links stay empty forever. Quiet
    no-op if the incident isn't found (a photo can be tagged to an incident whose
    own POST is still sitting in the offline queue; that POST exports on arrival)."""
    uuid = (incident_uuid or "").strip()
    if not uuid:
        return
    inc = db.query(Incident).filter(Incident.incident_uuid == uuid).first()
    if inc is not None:
        _export(inc)


@router.post("", response_model=IncidentOut, status_code=201)
def create_incident(
    body: IncidentIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.incident_uuid.strip():
        raise HTTPException(status_code=400, detail="incident_uuid required")
    if not (body.description or "").strip():
        raise HTTPException(status_code=400, detail="Description required")

    severity = body.severity if body.severity in SEVERITIES else "minor"
    attributable = body.attributable if body.attributable in ATTRIBUTABLE else "unknown"

    # Idempotent: the offline queue retries with the same uuid. Update the
    # existing row rather than duplicating.
    inc = db.query(Incident).filter(Incident.incident_uuid == body.incident_uuid).first()
    now = datetime.now(timezone.utc)
    if inc is None:
        inc = Incident(incident_uuid=body.incident_uuid.strip(), created_at=now)
        db.add(inc)

    # Claim number is client-generated and immutable once set. A retry sends the
    # same value; never wipe an existing claim number if a later payload omits it.
    inc.claim_number = (body.claim_number or "").strip() or inc.claim_number
    inc.job_uuid = (body.job_uuid or "").strip() or None
    inc.job_name = (body.job_name or "").strip() or None
    inc.incident_date = (body.incident_date or "").strip() or None
    inc.reported_by_id = current_user.id
    inc.reported_by_name = current_user.name or current_user.email
    inc.attributed_crew = (body.attributed_crew or "").strip() or None
    inc.severity = severity
    inc.attributable = attributable
    inc.description = (body.description or "").strip()
    inc.est_cost = body.est_cost
    inc.resolved = bool(body.resolved)
    inc.notes = (body.notes or "").strip() or None
    inc.photo_urls = json.dumps([u for u in body.photo_urls if isinstance(u, str) and u.strip()])
    inc.updated_at = now

    db.commit()
    db.refresh(inc)
    _export(inc)
    return _to_out(inc)


@router.get("", response_model=List[IncidentOut])
def list_job_incidents(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(Incident)
        .filter(Incident.job_uuid == job_uuid)
        .order_by(Incident.created_at.desc())
        .limit(200)
        .all()
    )
    return [_to_out(r) for r in rows]


class ResolveIn(BaseModel):
    resolved: bool = True


@router.patch("/{incident_uuid}/resolve", response_model=IncidentOut)
def resolve_incident(
    incident_uuid: str,
    body: ResolveIn = ResolveIn(),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Crew-facing: mark a submitted incident resolved (or not) on site after the
    fact - the resolution often happens after the report was filed. Keyed by the
    client's incident_uuid. Idempotent; re-exports the row to the sheet."""
    inc = db.query(Incident).filter(Incident.incident_uuid == incident_uuid).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    inc.resolved = bool(body.resolved)
    inc.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(inc)
    _export(inc)
    return _to_out(inc)


@admin_router.get("", response_model=List[IncidentOut])
def list_all_incidents(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(Incident).order_by(Incident.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]


class IncidentPatch(BaseModel):
    resolved: Optional[bool] = None
    notes: Optional[str] = None
    est_cost: Optional[float] = None


@admin_router.patch("/{incident_id}", response_model=IncidentOut)
def update_incident(
    incident_id: int,
    body: IncidentPatch,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    inc = db.query(Incident).filter(Incident.id == incident_id).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    if body.resolved is not None:
        inc.resolved = body.resolved
    if body.notes is not None:
        inc.notes = body.notes.strip() or None
    if body.est_cost is not None:
        inc.est_cost = body.est_cost
    inc.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(inc)
    _export(inc)
    return _to_out(inc)
