from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.long_distance import LdDay, PriorOnDutyStatement, RodsLog
from app.db.models.user import User
from app.integrations.sheets_export import (
    export_ld_day_to_sheets,
    export_prior_hours_to_sheets,
    export_rods_to_sheets,
    run_export_in_background,
)
from app.schemas.long_distance import (
    DailyHours,
    DutyChange,
    PriorOnDutyCreate,
    PriorOnDutyResponse,
    RodsCreate,
    RodsResponse,
)

router = APIRouter(prefix="/api/long-distance", tags=["long-distance"])


def _http_json(url: str, headers: Optional[dict] = None, timeout: int = 8):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _google_miles(origin: str, destination: str, key: str) -> Optional[int]:
    qs = urllib.parse.urlencode({"origins": origin, "destinations": destination, "units": "imperial", "key": key})
    data = _http_json(f"https://maps.googleapis.com/maps/api/distancematrix/json?{qs}")
    element = (data.get("rows") or [{}])[0].get("elements", [{}])[0]
    if element.get("status") == "OK":
        return round(element.get("distance", {}).get("value", 0) / 1609.344)
    return None


def _geocode_osm(place: str) -> Optional[tuple]:
    qs = urllib.parse.urlencode({"q": place, "format": "json", "limit": 1})
    data = _http_json(
        f"https://nominatim.openstreetmap.org/search?{qs}",
        headers={"User-Agent": "MountaineerMovingCrewApp/1.0 (dispatch)"},
    )
    if data:
        return float(data[0]["lat"]), float(data[0]["lon"])
    return None


def _osrm_miles(origin: str, destination: str) -> Optional[int]:
    a = _geocode_osm(origin)
    b = _geocode_osm(destination)
    if not a or not b:
        return None
    url = f"https://router.project-osrm.org/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=false"
    routes = _http_json(url).get("routes") or []
    if routes:
        return round(routes[0]["distance"] / 1609.344)
    return None


@router.get("/distance")
def driving_distance(
    origin: str = Query(...),
    destination: str = Query(...),
    current_user: User = Depends(get_current_user),
):
    """Driving miles between two places. Uses the Google Maps Distance Matrix API
    if GOOGLE_MAPS_API_KEY is set, otherwise a free fallback (OpenStreetMap
    geocoding + OSRM routing) so the RODS "Auto" button works out of the box.
    Returns {miles: null} gracefully when nothing resolves (manual entry)."""
    o, d = origin.strip(), destination.strip()
    if not o or not d:
        return {"ok": False, "miles": None, "reason": "missing_input"}
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if key:
        try:
            miles = _google_miles(o, d, key)
            if miles is not None:
                return {"ok": True, "miles": miles, "source": "google"}
        except Exception:
            pass  # fall through to the free path
    try:
        miles = _osrm_miles(o, d)
        if miles is not None:
            return {"ok": True, "miles": miles, "source": "osm"}
    except Exception:
        pass
    return {"ok": False, "miles": None, "reason": "no_route"}


def _to_response(s: PriorOnDutyStatement) -> PriorOnDutyResponse:
    raw = json.loads(s.daily_hours_json) if s.daily_hours_json else []
    daily = [DailyHours(**row) for row in raw]
    return PriorOnDutyResponse(
        id=s.id,
        statement_id=s.statement_id,
        driver_id=s.driver_id,
        driver_name=s.driver_name,
        job_uuid=s.job_uuid,
        job_name=s.job_name,
        statement_date=s.statement_date,
        daily_hours=daily,
        hours_last_24=float(s.hours_last_24 or 0),
        signature=s.signature,
        signed_at=s.signed_at,
        created_at=s.created_at,
    )


@router.post("/prior-hours", response_model=PriorOnDutyResponse, status_code=status.HTTP_201_CREATED)
def create_prior_hours(
    body: PriorOnDutyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = (
        db.query(PriorOnDutyStatement)
        .filter(PriorOnDutyStatement.statement_id == body.statement_id)
        .first()
    )
    if existing:
        return _to_response(existing)

    row = PriorOnDutyStatement(
        statement_id=body.statement_id,
        driver_id=current_user.id,
        driver_name=body.driver_name.strip(),
        job_uuid=(body.job_uuid or None),
        job_name=(body.job_name or None),
        statement_date=body.statement_date,
        daily_hours_json=json.dumps([d.model_dump() for d in body.daily_hours]),
        hours_last_24=str(body.hours_last_24),
        signature=body.signature,
        signed_at=body.signed_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    run_export_in_background(export_prior_hours_to_sheets, _to_response(row).model_dump())

    return _to_response(row)


@router.get("/prior-hours", response_model=List[PriorOnDutyResponse])
def list_my_prior_hours(
    job_uuid: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """This driver's Prior On-Duty statements (newest first). If job_uuid is
    given, only statements for that trip (so the LD report can check per-trip)."""
    q = db.query(PriorOnDutyStatement).filter(PriorOnDutyStatement.driver_id == current_user.id)
    if job_uuid:
        q = q.filter(PriorOnDutyStatement.job_uuid == job_uuid)
    rows = q.order_by(PriorOnDutyStatement.created_at.desc()).limit(50).all()
    return [_to_response(r) for r in rows]


# ── RODS ─────────────────────────────────────────────────────────────────


def _rods_to_response(r: RodsLog) -> RodsResponse:
    raw = json.loads(r.duty_changes_json) if r.duty_changes_json else []
    changes = [DutyChange(**row) for row in raw]
    return RodsResponse(
        id=r.id,
        rods_id=r.rods_id,
        driver_id=r.driver_id,
        driver_name=r.driver_name,
        log_date=r.log_date,
        co_driver_name=r.co_driver_name,
        vehicle_number=r.vehicle_number,
        trailer_number=r.trailer_number,
        origin=r.origin,
        destination=r.destination,
        total_miles=r.total_miles,
        shipping_docs=r.shipping_docs,
        carrier=r.carrier,
        main_office_address=r.main_office_address,
        duty_changes=changes,
        remarks=r.remarks,
        total_off_duty=r.total_off_duty,
        total_sleeper=r.total_sleeper,
        total_driving=r.total_driving,
        total_on_duty=r.total_on_duty,
        signature=r.signature,
        signed_at=r.signed_at,
        created_at=r.created_at,
    )


@router.post("/rods", response_model=RodsResponse)
def create_rods(
    body: RodsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or UPDATE this driver's Record of Duty Status for a day.

    RODS is now a resumable, tap-recorded daily log: the recorder appends duty
    changes through the day and re-submits, and the driver may reopen a day to
    finalize/sign. So this upserts by (driver_id, log_date) - one row per driver
    per day - updating the duty changes, totals, and signature in place. The
    original rods_id + created_at are preserved so the Sheet row (replace-style
    export) tracks the same entity across the day.
    """
    existing = (
        db.query(RodsLog)
        .filter(RodsLog.driver_id == current_user.id, RodsLog.log_date == body.log_date)
        .first()
    )

    if existing is not None:
        existing.driver_name = body.driver_name.strip()
        existing.co_driver_name = (body.co_driver_name or "").strip() or None
        existing.vehicle_number = (body.vehicle_number or "").strip() or None
        existing.trailer_number = (body.trailer_number or "").strip() or None
        existing.origin = (body.origin or "").strip() or None
        existing.destination = (body.destination or "").strip() or None
        existing.total_miles = (body.total_miles or "").strip() or None
        existing.shipping_docs = (body.shipping_docs or "").strip() or None
        existing.carrier = (body.carrier or "").strip() or None
        existing.main_office_address = (body.main_office_address or "").strip() or None
        existing.duty_changes_json = json.dumps([d.model_dump() for d in body.duty_changes])
        existing.remarks = (body.remarks or "").strip() or None
        existing.total_off_duty = body.total_off_duty
        existing.total_sleeper = body.total_sleeper
        existing.total_driving = body.total_driving
        existing.total_on_duty = body.total_on_duty
        # Only attach a signature when one is provided - an unsigned autosave
        # (continuity backup) must NOT wipe a signature already captured on
        # another device.
        if body.signature is not None:
            existing.signature = body.signature
            existing.signed_at = body.signed_at
        db.commit()
        db.refresh(existing)
        # Sheet = signed compliance record; unsigned autosaves stay DB-only so
        # in-progress taps don't spam the replace-style Sheets export.
        if existing.signature:
            run_export_in_background(export_rods_to_sheets, _rods_to_response(existing).model_dump())
        return _rods_to_response(existing)

    row = RodsLog(
        rods_id=body.rods_id,
        driver_id=current_user.id,
        driver_name=body.driver_name.strip(),
        log_date=body.log_date,
        co_driver_name=(body.co_driver_name or "").strip() or None,
        vehicle_number=(body.vehicle_number or "").strip() or None,
        trailer_number=(body.trailer_number or "").strip() or None,
        origin=(body.origin or "").strip() or None,
        destination=(body.destination or "").strip() or None,
        total_miles=(body.total_miles or "").strip() or None,
        shipping_docs=(body.shipping_docs or "").strip() or None,
        carrier=(body.carrier or "").strip() or None,
        main_office_address=(body.main_office_address or "").strip() or None,
        duty_changes_json=json.dumps([d.model_dump() for d in body.duty_changes]),
        remarks=(body.remarks or "").strip() or None,
        total_off_duty=body.total_off_duty,
        total_sleeper=body.total_sleeper,
        total_driving=body.total_driving,
        total_on_duty=body.total_on_duty,
        signature=body.signature,
        signed_at=body.signed_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    if row.signature:
        run_export_in_background(export_rods_to_sheets, _rods_to_response(row).model_dump())

    return _rods_to_response(row)


@router.get("/rods", response_model=List[RodsResponse])
def list_my_rods(
    log_date: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List this driver's RODS logs (newest first). If log_date is given, return
    just that day (used by the recorder to resume a day across devices)."""
    q = db.query(RodsLog).filter(RodsLog.driver_id == current_user.id)
    if log_date:
        q = q.filter(RodsLog.log_date == log_date)
    rows = q.order_by(RodsLog.created_at.desc()).limit(50).all()
    return [_rods_to_response(r) for r in rows]


# ── Per-diem / drive-day (payroll) ────────────────────────────────────────


class LdDayIn(BaseModel):
    day_id: str
    date: str                       # YYYY-MM-DD
    job_uuid: str | None = ""
    job_name: str | None = ""
    out_of_town: bool = False
    drive_day: bool = False


def _ld_to_dict(r: LdDay) -> dict:
    return {
        "day_id": r.day_id,
        "date": r.date,
        "job_uuid": r.job_uuid or "",
        "job_name": r.job_name or "",
        "driver_name": r.driver_name,
        "out_of_town": bool(r.out_of_town),
        "drive_day": bool(r.drive_day),
        "per_diem": 50.0 if r.out_of_town else 0.0,
        "created_at": r.created_at.isoformat() if r.created_at else "",
        "updated_at": r.updated_at.isoformat() if r.updated_at else "",
    }


@router.post("/day")
def upsert_ld_day(
    body: LdDayIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark whether a day was out of town / a drive day. Upsert by (driver, date)."""
    now = datetime.now(timezone.utc)
    row = (
        db.query(LdDay)
        .filter(LdDay.driver_id == current_user.id, LdDay.date == body.date)
        .first()
    )
    if row is not None:
        row.out_of_town = body.out_of_town
        row.drive_day = body.drive_day
        if body.job_uuid:
            row.job_uuid = body.job_uuid
        if body.job_name:
            row.job_name = body.job_name
        row.updated_at = now
    else:
        row = LdDay(
            day_id=body.day_id,
            driver_id=current_user.id,
            driver_name=current_user.name or current_user.email or "",
            job_uuid=body.job_uuid or None,
            job_name=body.job_name or None,
            date=body.date,
            out_of_town=body.out_of_town,
            drive_day=body.drive_day,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    run_export_in_background(export_ld_day_to_sheets, _ld_to_dict(row))
    return {"ok": True, "day": _ld_to_dict(row)}


@router.get("/day")
def list_ld_days(
    job_uuid: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List day records. Filtered by job_uuid it returns every crew member's
    days for that trip (for the Report per-diem tally); otherwise the current
    driver's own days."""
    q = db.query(LdDay)
    if job_uuid:
        q = q.filter(LdDay.job_uuid == job_uuid)
    else:
        q = q.filter(LdDay.driver_id == current_user.id)
    rows = q.order_by(LdDay.date.desc()).limit(200).all()
    return {"ok": True, "days": [_ld_to_dict(r) for r in rows]}
