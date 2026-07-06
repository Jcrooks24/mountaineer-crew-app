from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.job_inventory import JobInventoryItem
from app.db.models.user import User
from app.integrations.sheets_export import schedule_job_inventory_export
from app.schemas.job_inventory import (
    JobInventoryItemIn,
    JobInventoryItemOut,
    JobInventoryItemPatch,
    JobInventoryResponse,
)

router = APIRouter(prefix="/api/job-inventory", tags=["job-inventory"])


def _items_for(db: Session, job_uuid: str) -> list[JobInventoryItem]:
    return (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.job_uuid == job_uuid)
        .order_by(JobInventoryItem.id.asc())
        .all()
    )


def counts_for(items: list[JobInventoryItem]) -> tuple[int, int]:
    """(furniture_count, box_count) from a list of inventory rows."""
    furniture = sum((it.qty or 0) for it in items if not it.is_box)
    boxes = sum((it.qty or 0) for it in items if it.is_box)
    return furniture, boxes


def _response(db: Session, job_uuid: str) -> JobInventoryResponse:
    items = _items_for(db, job_uuid)
    furniture, boxes = counts_for(items)
    return JobInventoryResponse(
        job_uuid=job_uuid,
        items=[JobInventoryItemOut.model_validate(it) for it in items],
        furniture_count=furniture,
        box_count=boxes,
    )


@router.get("/{job_uuid}", response_model=JobInventoryResponse)
def get_job_inventory(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Always 200 (empty list + zero counts when nothing logged yet) so the
    # crew UI can start adding without a create step.
    return _response(db, job_uuid)


@router.post("/{job_uuid}/items", response_model=JobInventoryItemOut, status_code=status.HTTP_201_CREATED)
def add_item(
    job_uuid: str,
    body: JobInventoryItemIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    now = datetime.now(timezone.utc)
    item = JobInventoryItem(
        job_uuid=job_uuid,
        name=name,
        qty=max(1, int(body.qty or 1)),
        is_box=bool(body.is_box),
        room=(body.room or "").strip() or None,
        notes=(body.notes or "").strip() or None,
        created_by_id=current_user.id,
        created_by_name=current_user.name or current_user.email,
        created_at=now,
        updated_at=now,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    schedule_job_inventory_export(job_uuid)
    return item


@router.patch("/{job_uuid}/items/{item_id}", response_model=JobInventoryItemOut)
def update_item(
    job_uuid: str,
    item_id: int,
    body: JobInventoryItemPatch,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    item = (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.id == item_id, JobInventoryItem.job_uuid == job_uuid)
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
    if body.is_box is not None:
        item.is_box = bool(body.is_box)
    if body.room is not None:
        item.room = body.room.strip() or None
    if body.notes is not None:
        item.notes = body.notes.strip() or None
    item.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(item)
    schedule_job_inventory_export(job_uuid)
    return item


@router.delete("/{job_uuid}/items/{item_id}", status_code=204)
def remove_item(
    job_uuid: str,
    item_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    item = (
        db.query(JobInventoryItem)
        .filter(JobInventoryItem.id == item_id, JobInventoryItem.job_uuid == job_uuid)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    schedule_job_inventory_export(job_uuid)
