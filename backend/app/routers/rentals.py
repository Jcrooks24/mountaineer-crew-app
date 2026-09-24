"""
Rental trucks router (ADR 0055).

The truck picker's list of rentals, each job's rentals, entering or updating a
truck from the job header or anywhere else, and marking one returned. The DVIR
creates and links trucks inside its own submit (routers/dvir.py) so the
inspection and the truck record land together.

Crew-facing: any signed-in user can enter a rental, because "admin or sometimes
crew drivers pick up trucks" (owner, 2026-09-17).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import rental_trucks as rt
from app.core.deps import get_current_user, get_db
from app.db.models.rental_truck import RentalTruck
from app.db.models.user import User
from app.integrations.sheets_export import schedule_rental_truck_export

router = APIRouter(prefix="/api/rentals", tags=["rentals"])


class RentalIn(BaseModel):
    unit_name: str
    plate: str
    company: Optional[str] = None
    agreement_number: Optional[str] = None
    gvwr_lbs: Optional[float] = None
    notes: Optional[str] = None
    job_uuid: Optional[str] = None
    job_name: Optional[str] = None
    job_date: Optional[str] = None


@router.get("")
def list_active(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Rentals offered in the truck list: not returned, used in the last 10 days."""
    return {"rentals": rt.serialize(db, rt.active_rentals(db)), "idle_days": rt.IDLE_DAYS}


@router.get("/for-job/{job_uuid}")
def list_for_job(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Every truck linked to this job, most recent first, returned or not."""
    return {"job_uuid": job_uuid, "rentals": rt.serialize(db, rt.rentals_for_job(db, job_uuid))}


@router.put("/{rental_uuid}")
def upsert(
    rental_uuid: str,
    body: RentalIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Enter or update a truck and, when a job is given, link it. Idempotent."""
    try:
        row = rt.upsert_rental(
            db, rental_uuid=rental_uuid, unit_name=body.unit_name, plate=body.plate,
            company=body.company, agreement_number=body.agreement_number,
            gvwr_lbs=body.gvwr_lbs, notes=body.notes, user=current_user,
        )
    except rt.PlateLocked as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    rt.link_rental_to_job(
        db, row, job_uuid=body.job_uuid, job_name=body.job_name, job_date=body.job_date,
        source="job_setup", user=current_user,
    )
    db.commit()
    schedule_rental_truck_export(row.rental_uuid)
    return {"rental": rt.serialize(db, [row])[0]}


@router.delete("/{rental_uuid}/jobs/{job_uuid}")
def unlink_from_job(
    rental_uuid: str,
    job_uuid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Undo a wrong pick at job setup. Refused once an inspection on this job
    was filed against the truck: then the link is the record of which truck did
    the work, and removing it would leave that inspection unexplained."""
    from app.db.models.dvir import DVIR
    from app.db.models.rental_truck import RentalTruckJob

    inspected = (
        db.query(DVIR.id)
        .filter(DVIR.rental_uuid == rental_uuid, DVIR.job_uuid == job_uuid)
        .first()
    )
    if inspected is not None:
        raise HTTPException(
            status_code=409,
            detail="This truck has an inspection filed on this job, so it stays linked to it.",
        )
    db.query(RentalTruckJob).filter(
        RentalTruckJob.rental_uuid == rental_uuid, RentalTruckJob.job_uuid == job_uuid,
    ).delete(synchronize_session=False)
    db.commit()
    schedule_rental_truck_export(rental_uuid)
    return {"ok": True}


@router.post("/{rental_uuid}/return")
def mark_returned(
    rental_uuid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """The truck went back to the rental company. Hides it from the truck list;
    the record and every inspection on it stay. Idempotent."""
    row = db.query(RentalTruck).filter(RentalTruck.rental_uuid == rental_uuid).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Rental truck not found.")
    rt.mark_returned(db, row, current_user)
    db.commit()
    schedule_rental_truck_export(row.rental_uuid)
    return {"rental": rt.serialize(db, [row])[0]}
