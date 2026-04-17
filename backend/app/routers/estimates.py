from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.db.models.estimate import Estimate, EstimateItem
from app.db.models.user import User
from app.schemas.estimate import (
    EstimateCreate,
    EstimateItemIn,
    EstimateItemOut,
    EstimateResponse,
    EstimateUpdate,
)

router = APIRouter(prefix="/api/estimates", tags=["estimates"])


def _recalc_totals(e: Estimate) -> None:
    e.estimated_weight_lbs = float(sum((it.weight_lbs or 0) * (it.qty or 0) for it in e.items))
    e.estimated_cubic_ft = float(sum((it.cubic_ft or 0) * (it.qty or 0) for it in e.items))


def _touch(e: Estimate) -> None:
    e.updated_at = datetime.now(timezone.utc)


@router.get("", response_model=List[EstimateResponse])
def list_estimates(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return (
        db.query(Estimate)
        .order_by(Estimate.created_at.desc())
        .all()
    )


@router.post("", response_model=EstimateResponse, status_code=status.HTTP_201_CREATED)
def create_estimate(
    body: EstimateCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    existing = db.query(Estimate).filter(Estimate.estimate_uuid == body.estimate_uuid).first()
    if existing:
        return existing

    now = datetime.now(timezone.utc)
    e = Estimate(
        estimate_uuid=body.estimate_uuid,
        created_by_id=admin.id,
        created_by_name=admin.name or admin.email or "",
        customer_name=body.customer_name.strip(),
        customer_email=(body.customer_email or "").strip() or None,
        customer_phone=(body.customer_phone or "").strip() or None,
        origin_address=(body.origin_address or "").strip() or None,
        destination_address=(body.destination_address or "").strip() or None,
        move_date=(body.move_date or "").strip() or None,
        origin_access_notes=(body.origin_access_notes or "").strip() or None,
        destination_access_notes=(body.destination_access_notes or "").strip() or None,
        special_items_notes=(body.special_items_notes or "").strip() or None,
        general_notes=(body.general_notes or "").strip() or None,
        estimated_weight_lbs=0,
        estimated_cubic_ft=0,
        created_at=now,
        updated_at=now,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


@router.get("/{estimate_uuid}", response_model=EstimateResponse)
def get_estimate(
    estimate_uuid: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return e


@router.patch("/{estimate_uuid}", response_model=EstimateResponse)
def update_estimate(
    estimate_uuid: str,
    body: EstimateUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")

    for field in (
        "customer_name",
        "customer_email",
        "customer_phone",
        "origin_address",
        "destination_address",
        "move_date",
        "origin_access_notes",
        "destination_access_notes",
        "special_items_notes",
        "general_notes",
    ):
        val = getattr(body, field)
        if val is not None:
            val = val.strip() or None
            setattr(e, field, val)

    _touch(e)
    db.commit()
    db.refresh(e)
    return e


@router.delete("/{estimate_uuid}", status_code=204)
def delete_estimate(
    estimate_uuid: str,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")
    db.delete(e)
    db.commit()


@router.post("/{estimate_uuid}/items", response_model=EstimateItemOut, status_code=status.HTTP_201_CREATED)
def add_item(
    estimate_uuid: str,
    body: EstimateItemIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")

    item = EstimateItem(
        estimate_id=e.id,
        name=body.name.strip(),
        qty=max(1, int(body.qty or 1)),
        weight_lbs=float(body.weight_lbs or 0),
        cubic_ft=float(body.cubic_ft or 0),
        notes=(body.notes or "").strip() or None,
    )
    db.add(item)
    db.flush()
    e.items.append(item)
    _recalc_totals(e)
    _touch(e)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{estimate_uuid}/items/{item_id}", status_code=204)
def remove_item(
    estimate_uuid: str,
    item_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")
    item = db.query(EstimateItem).filter(
        EstimateItem.id == item_id, EstimateItem.estimate_id == e.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.flush()
    db.refresh(e)
    _recalc_totals(e)
    _touch(e)
    db.commit()
