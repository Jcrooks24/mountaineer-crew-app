from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.long_distance import PriorOnDutyStatement, RodsLog
from app.db.models.user import User
from app.integrations.sheets_export import (
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


def _to_response(s: PriorOnDutyStatement) -> PriorOnDutyResponse:
    raw = json.loads(s.daily_hours_json) if s.daily_hours_json else []
    daily = [DailyHours(**row) for row in raw]
    return PriorOnDutyResponse(
        id=s.id,
        statement_id=s.statement_id,
        driver_id=s.driver_id,
        driver_name=s.driver_name,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(PriorOnDutyStatement)
        .filter(PriorOnDutyStatement.driver_id == current_user.id)
        .order_by(PriorOnDutyStatement.created_at.desc())
        .limit(50)
        .all()
    )
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


@router.post("/rods", response_model=RodsResponse, status_code=status.HTTP_201_CREATED)
def create_rods(
    body: RodsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(RodsLog).filter(RodsLog.rods_id == body.rods_id).first()
    if existing:
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

    run_export_in_background(export_rods_to_sheets, _rods_to_response(row).model_dump())

    return _rods_to_response(row)


@router.get("/rods", response_model=List[RodsResponse])
def list_my_rods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(RodsLog)
        .filter(RodsLog.driver_id == current_user.id)
        .order_by(RodsLog.created_at.desc())
        .limit(50)
        .all()
    )
    return [_rods_to_response(r) for r in rows]
