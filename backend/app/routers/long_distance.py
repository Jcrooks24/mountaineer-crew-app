from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.long_distance import PriorOnDutyStatement
from app.db.models.user import User
from app.schemas.long_distance import (
    DailyHours,
    PriorOnDutyCreate,
    PriorOnDutyResponse,
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
