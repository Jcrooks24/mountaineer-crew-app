from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class JobInventoryItemIn(BaseModel):
    name: str
    qty: int = 1
    is_box: bool = False
    # "CP" | "PBO" | "NA" for boxes; None for furniture.
    pack_type: Optional[str] = None
    room: Optional[str] = None
    notes: Optional[str] = None
    # Client-minted idempotency key. Optional so an older app build (which does
    # not send one) keeps working; when present the add is an upsert.
    item_uuid: Optional[str] = None


class JobInventoryItemPatch(BaseModel):
    name: Optional[str] = None
    qty: Optional[int] = None
    is_box: Optional[bool] = None
    pack_type: Optional[str] = None
    room: Optional[str] = None
    notes: Optional[str] = None


class JobInventoryItemOut(BaseModel):
    id: int
    item_uuid: Optional[str] = None
    name: str
    qty: int
    is_box: bool
    pack_type: Optional[str] = None
    room: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class JobInventoryResponse(BaseModel):
    job_uuid: str
    items: List[JobInventoryItemOut]
    # Derived: furniture_count = sum(qty where not is_box),
    #          box_count       = sum(qty where is_box).
    furniture_count: int
    box_count: int
