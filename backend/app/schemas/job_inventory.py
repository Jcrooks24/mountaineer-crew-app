from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class JobInventoryItemIn(BaseModel):
    name: str
    qty: int = 1
    is_box: bool = False
    room: Optional[str] = None
    notes: Optional[str] = None


class JobInventoryItemPatch(BaseModel):
    name: Optional[str] = None
    qty: Optional[int] = None
    is_box: Optional[bool] = None
    room: Optional[str] = None
    notes: Optional[str] = None


class JobInventoryItemOut(BaseModel):
    id: int
    name: str
    qty: int
    is_box: bool
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
