from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.estimate import Estimate, EstimateItem, FurnitureCatalogItem
from app.db.models.user import User
from app.integrations.sheets_export import schedule_estimate_export
from app.schemas.estimate import (
    CatalogItemIn,
    CatalogItemOut,
    EstimateCreate,
    EstimateItemIn,
    EstimateItemOut,
    EstimateItemPatch,
    EstimateResponse,
    EstimateUpdate,
)

router = APIRouter(prefix="/api/estimates", tags=["estimates"])


def _recalc_totals(e: Estimate) -> None:
    e.estimated_weight_lbs = float(sum((it.weight_lbs or 0) * (it.qty or 0) for it in e.items))
    e.estimated_cubic_ft = float(sum((it.cubic_ft or 0) * (it.qty or 0) for it in e.items))


def _touch(e: Estimate) -> None:
    e.updated_at = datetime.now(timezone.utc)


def _export_estimate(db: Session, e: Estimate) -> None:
    schedule_estimate_export(e.estimate_uuid)


# ── Furniture catalog (admin-editable).
# Declared before the `/{estimate_uuid}` routes so FastAPI doesn't treat
# "catalog" as an estimate UUID.

@router.get("/catalog", response_model=List[CatalogItemOut])
def list_catalog(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return (
        db.query(FurnitureCatalogItem)
        .order_by(FurnitureCatalogItem.category.asc().nullsfirst(), FurnitureCatalogItem.name.asc())
        .limit(2000)
        .all()
    )


@router.post("/catalog", response_model=CatalogItemOut, status_code=status.HTTP_201_CREATED)
def add_catalog(
    body: CatalogItemIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    existing = db.query(FurnitureCatalogItem).filter(FurnitureCatalogItem.name == name).first()
    if existing:
        # Upsert weight/cu ft if supplied; return existing row
        if body.weight_lbs > 0:
            existing.weight_lbs = float(body.weight_lbs)
        if body.cubic_ft > 0:
            existing.cubic_ft = float(body.cubic_ft)
        if body.category:
            existing.category = body.category.strip() or None
        db.commit()
        db.refresh(existing)
        return existing
    row = FurnitureCatalogItem(
        name=name,
        weight_lbs=float(body.weight_lbs or 0),
        cubic_ft=float(body.cubic_ft or 0),
        category=(body.category or "").strip() or None,
        created_by_id=admin.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/catalog/{item_id}", status_code=204)
def remove_catalog(
    item_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    row = db.query(FurnitureCatalogItem).filter(FurnitureCatalogItem.id == item_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Catalog item not found")
    db.delete(row)
    db.commit()


# ── Estimate CRUD


@router.get("", response_model=List[EstimateResponse])
def list_estimates(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    return (
        db.query(Estimate)
        .order_by(Estimate.created_at.desc())
        .limit(500)
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
    _export_estimate(db, e)
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

    # Estimated hours (float, not a string field). None = leave as-is.
    if body.estimated_hours is not None:
        e.estimated_hours = max(0.0, float(body.estimated_hours))

    _touch(e)
    db.commit()
    db.refresh(e)
    _export_estimate(db, e)
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
    # Reconcile the sheet: routed through the same coalescing worker as exports,
    # which now sees no estimate for this uuid and removes its (ghost) summary +
    # item rows. Going through schedule_* serializes it with any in-flight export
    # so a delete can't race a write.
    schedule_estimate_export(estimate_uuid)


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

    # Idempotency. The add is queued on the device and retried, so a response
    # lost mid-flight must not add the item to the estimate twice (which would
    # also double-count it in the weight/volume totals below).
    item_uuid = (body.item_uuid or "").strip() or None
    if item_uuid:
        existing = (
            db.query(EstimateItem).filter(EstimateItem.item_uuid == item_uuid).first()
        )
        if existing:
            return existing

    item = EstimateItem(
        item_uuid=item_uuid,
        estimate_id=e.id,
        name=body.name.strip(),
        qty=max(1, int(body.qty or 1)),
        weight_lbs=float(body.weight_lbs or 0),
        cubic_ft=float(body.cubic_ft or 0),
        room=(body.room or "").strip() or None,
        subcategory=(body.subcategory or "").strip() or None,
        notes=(body.notes or "").strip() or None,
    )
    db.add(item)
    db.flush()
    # Do NOT `e.items.append(item)` here. `items` is lazy, so after the flush the
    # first touch of it loads from the DB and ALREADY contains this row; a manual
    # append then puts the same object in the list twice. The row count stays
    # correct (same PK), which is why this went unseen, but _recalc_totals sums
    # the list, so every add double-counted its own weight and volume into the
    # estimate totals. Expire instead: the next touch reloads it exactly once.
    db.expire(e, ["items"])
    _recalc_totals(e)
    _touch(e)
    try:
        db.commit()
    except IntegrityError:
        # Raced a concurrent retry of the same item_uuid. The unique index is
        # the real guard; the SELECT above is just the fast path. Totals are
        # rolled back with the insert, so they stay consistent.
        db.rollback()
        existing = (
            db.query(EstimateItem).filter(EstimateItem.item_uuid == item_uuid).first()
        )
        if existing:
            return existing
        raise
    db.refresh(item)
    db.refresh(e)
    _export_estimate(db, e)
    return item


@router.patch("/{estimate_uuid}/items/{item_id}", response_model=EstimateItemOut)
def update_item(
    estimate_uuid: str,
    item_id: int,
    body: EstimateItemPatch,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    e = db.query(Estimate).filter(Estimate.estimate_uuid == estimate_uuid).first()
    if not e:
        raise HTTPException(status_code=404, detail="Estimate not found")
    item = (
        db.query(EstimateItem)
        .filter(EstimateItem.id == item_id, EstimateItem.estimate_id == e.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be blank")
        item.name = name
    if body.qty is not None:
        item.qty = max(1, int(body.qty))
    if body.weight_lbs is not None:
        item.weight_lbs = max(0.0, float(body.weight_lbs))
    if body.cubic_ft is not None:
        item.cubic_ft = max(0.0, float(body.cubic_ft))
    if body.room is not None:
        item.room = body.room.strip() or None
    if body.subcategory is not None:
        item.subcategory = body.subcategory.strip() or None
    if body.notes is not None:
        item.notes = body.notes.strip() or None

    _recalc_totals(e)
    _touch(e)
    db.commit()
    db.refresh(item)
    db.refresh(e)
    _export_estimate(db, e)
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
    db.refresh(e)
    _export_estimate(db, e)
