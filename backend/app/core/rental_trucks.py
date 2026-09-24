"""
Rental truck records: create, link to a job, list for the truck picker (ADR 0055).

Two writers share this: the DVIR (crew at the truck, the usual place a rental is
first entered) and the job header (admin at booking, or crew). Both go through
`upsert_rental` + `link_rental_to_job` so the rules live in one place:

  - One live record per physical truck. A new entry whose plate matches a truck
    that has not been marked returned REUSES that record rather than making a
    second one, so two phones entering the same truck offline converge.
  - Details only fill in. A later write never blanks a field someone already
    entered, because the DVIR and the header can each hold an older copy.
  - The plate is fixed once an inspection has been filed against the truck.
    The ADR 0053 prior-report review and out-of-service lockout key on it, so
    changing it would split one truck's inspection history in two.

Timestamps are naive UTC, matching the rest of the schema.
"""
from __future__ import annotations

import json
import re
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.db.models.rental_truck import RentalTruck, RentalTruckJob

# A rental leaves the truck list this long after it was last inspected or
# linked to a job, if nobody marked it returned. Owner's choice at intake,
# 2026-09-24.
IDLE_DAYS = 10


class PlateLocked(Exception):
    """The plate cannot change: an inspection is already filed against it."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def plate_key(plate: Optional[str]) -> str:
    """Normalize a plate for matching: case, spaces and dashes do not count."""
    return re.sub(r"[^A-Z0-9]", "", (plate or "").upper())


def _clean(v: Any) -> Optional[str]:
    s = (v or "").strip() if isinstance(v, str) else ""
    return s or None


def _clean_int(v: Any) -> Optional[int]:
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def is_rental_unit(db: Session, vehicle_number: Optional[str]) -> bool:
    """Is this fleet-registry entry a placeholder for a truck we rent?

    Unknown units are NOT rentals: a name the registry has never heard of is a
    data problem, and refusing the inspection would be the app deciding a truck
    cannot be inspected at all. See ADR 0053.
    """
    from app.core.vehicle_units import VEHICLE_UNITS_KEY, normalize_units
    from app.db.models.system_config import SystemConfig

    row = db.query(SystemConfig).filter(SystemConfig.key == VEHICLE_UNITS_KEY).first()
    if not row or not row.value:
        return False
    try:
        units = normalize_units(json.loads(row.value))
    except (ValueError, TypeError):
        return False
    name = (vehicle_number or "").strip().lower()
    return any(u.get("is_rental") and str(u.get("name", "")).strip().lower() == name for u in units)


def _has_inspection(db: Session, rental: RentalTruck) -> bool:
    from app.db.models.dvir import DVIR
    return db.query(DVIR.id).filter(DVIR.rental_uuid == rental.rental_uuid).first() is not None


def upsert_rental(
    db: Session,
    *,
    rental_uuid: Optional[str],
    unit_name: str,
    plate: str,
    company: Any = None,
    agreement_number: Any = None,
    gvwr_lbs: Any = None,
    notes: Any = None,
    user: Any = None,
    now: Optional[datetime] = None,
) -> RentalTruck:
    """Create or update one rental truck. Does not commit.

    Raises ValueError for a blank plate and PlateLocked for a plate change on a
    truck that already has an inspection.
    """
    now = now or utcnow()
    plate = (plate or "").strip()
    key = plate_key(plate)
    if not key:
        raise ValueError("A rental truck needs its plate or unit number.")

    row: Optional[RentalTruck] = None
    if rental_uuid:
        row = db.query(RentalTruck).filter(RentalTruck.rental_uuid == rental_uuid).first()
    if row is None:
        # Same truck entered again (a second phone, or the header and the DVIR
        # each creating it offline): join the live record instead of forking it.
        row = (
            db.query(RentalTruck)
            .filter(RentalTruck.plate_key == key, RentalTruck.returned_at.is_(None))
            .order_by(RentalTruck.last_used_at.desc())
            .first()
        )

    if row is None:
        row = RentalTruck(
            rental_uuid=(rental_uuid or "").strip() or str(_uuid.uuid4()),
            unit_name=(unit_name or "").strip() or "RENTAL",
            plate=plate,
            plate_key=key,
            created_by_id=getattr(user, "id", None),
            created_by_name=(getattr(user, "name", None) or getattr(user, "email", None)),
            created_at=now,
            last_used_at=now,
        )
        db.add(row)
    elif row.plate_key != key:
        if _has_inspection(db, row):
            raise PlateLocked(
                f"This truck already has an inspection filed as {row.plate}, so its "
                "plate cannot change. If it is a different truck, enter it as a new rental."
            )
        row.plate, row.plate_key = plate, key

    # Fill, never blank: a stale copy on another screen must not erase a detail.
    for attr, val in (
        ("company", _clean(company)),
        ("agreement_number", _clean(agreement_number)),
        ("gvwr_lbs", _clean_int(gvwr_lbs)),
        ("notes", _clean(notes)),
    ):
        if val is not None:
            setattr(row, attr, val)
    row.updated_at = now
    db.flush()
    return row


def link_rental_to_job(
    db: Session,
    rental: RentalTruck,
    *,
    job_uuid: Optional[str],
    job_name: Optional[str] = None,
    job_date: Optional[str] = None,
    source: str,
    user: Any = None,
    now: Optional[datetime] = None,
) -> Optional[RentalTruckJob]:
    """Record that this truck served this job, and mark the truck in use.

    Linking to a new job does not wait for the prior job to close out (owner,
    2026-09-24): a late close-out must never block a driver at the truck. A
    truck someone marked returned is back in service once it is linked again.
    Does not commit.
    """
    now = now or utcnow()
    rental.last_used_at = now
    if rental.returned_at is not None:
        rental.returned_at = None
        rental.returned_by_name = None
    ju = (job_uuid or "").strip()
    if not ju:
        db.flush()
        return None
    link = (
        db.query(RentalTruckJob)
        .filter(RentalTruckJob.rental_uuid == rental.rental_uuid, RentalTruckJob.job_uuid == ju)
        .first()
    )
    if link is None:
        link = RentalTruckJob(
            rental_uuid=rental.rental_uuid,
            job_uuid=ju,
            job_name=_clean(job_name),
            job_date=_clean(job_date),
            source=source,
            linked_by_id=getattr(user, "id", None),
            linked_by_name=(getattr(user, "name", None) or getattr(user, "email", None)),
            linked_at=now,
        )
        db.add(link)
    else:
        if not link.job_name and _clean(job_name):
            link.job_name = _clean(job_name)
        if not link.job_date and _clean(job_date):
            link.job_date = _clean(job_date)
    db.flush()
    return link


def mark_returned(db: Session, rental: RentalTruck, user: Any = None, now: Optional[datetime] = None) -> None:
    if rental.returned_at is None:
        rental.returned_at = now or utcnow()
        rental.returned_by_name = getattr(user, "name", None) or getattr(user, "email", None)
        rental.updated_at = rental.returned_at
    db.flush()


def _current_job_names(db: Session, job_uuids: Iterable[str]) -> Dict[str, str]:
    """The job header's CURRENT name wins over the snapshot taken at link time."""
    from app.db.models.job_setup import JobSetup
    ids = [j for j in set(job_uuids) if j]
    if not ids:
        return {}
    rows = db.query(JobSetup.job_uuid, JobSetup.job_name).filter(JobSetup.job_uuid.in_(ids)).all()
    return {ju: nm for ju, nm in rows if nm}


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return (dt.isoformat() + "Z") if dt else None


def to_out(
    rental: RentalTruck,
    links: List[RentalTruckJob],
    names: Dict[str, str],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or utcnow()
    ordered = sorted(links, key=lambda l: l.linked_at or datetime.min, reverse=True)
    jobs = [{
        "job_uuid": l.job_uuid,
        "job_name": names.get(l.job_uuid) or l.job_name or "",
        "job_date": l.job_date,
        "linked_at": _iso(l.linked_at),
        "linked_by_name": l.linked_by_name,
    } for l in ordered]
    idle_cutoff = now - timedelta(days=IDLE_DAYS)
    return {
        "rental_uuid": rental.rental_uuid,
        "unit_name": rental.unit_name,
        "plate": rental.plate,
        "company": rental.company,
        "agreement_number": rental.agreement_number,
        "gvwr_lbs": rental.gvwr_lbs,
        "notes": rental.notes,
        "jobs": jobs,
        # The label's job: the most recent one the truck was linked to.
        "latest_job_name": jobs[0]["job_name"] if jobs else "",
        "last_used_at": _iso(rental.last_used_at),
        "returned_at": _iso(rental.returned_at),
        "returned_by_name": rental.returned_by_name,
        "active": rental.returned_at is None and rental.last_used_at is not None
                  and rental.last_used_at >= idle_cutoff,
        "created_by_name": rental.created_by_name,
        "created_at": _iso(rental.created_at),
    }


def serialize(db: Session, rentals: List[RentalTruck], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    if not rentals:
        return []
    uuids = [r.rental_uuid for r in rentals]
    links = db.query(RentalTruckJob).filter(RentalTruckJob.rental_uuid.in_(uuids)).all()
    by: Dict[str, List[RentalTruckJob]] = {}
    for l in links:
        by.setdefault(l.rental_uuid, []).append(l)
    names = _current_job_names(db, (l.job_uuid for l in links))
    return [to_out(r, by.get(r.rental_uuid, []), names, now) for r in rentals]


def active_rentals(db: Session, now: Optional[datetime] = None) -> List[RentalTruck]:
    """Trucks offered in the picker: not returned, used in the last IDLE_DAYS."""
    now = now or utcnow()
    return (
        db.query(RentalTruck)
        .filter(
            RentalTruck.returned_at.is_(None),
            RentalTruck.last_used_at >= now - timedelta(days=IDLE_DAYS),
        )
        .order_by(RentalTruck.last_used_at.desc())
        .all()
    )


def rentals_for_job(db: Session, job_uuid: str) -> List[RentalTruck]:
    """Every truck linked to a job, most recently linked first."""
    links = (
        db.query(RentalTruckJob)
        .filter(RentalTruckJob.job_uuid == job_uuid)
        .order_by(RentalTruckJob.linked_at.desc())
        .all()
    )
    if not links:
        return []
    order = [l.rental_uuid for l in links]
    rows = {r.rental_uuid: r for r in db.query(RentalTruck).filter(RentalTruck.rental_uuid.in_(order)).all()}
    return [rows[u] for u in order if u in rows]
