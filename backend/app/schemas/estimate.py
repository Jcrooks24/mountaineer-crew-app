from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class EstimateItemIn(BaseModel):
    name: str
    qty: int = 1
    weight_lbs: float = 0
    cubic_ft: float = 0
    room: Optional[str] = None
    subcategory: Optional[str] = None
    notes: Optional[str] = None


class EstimateItemPatch(BaseModel):
    name: Optional[str] = None
    qty: Optional[int] = None
    weight_lbs: Optional[float] = None
    cubic_ft: Optional[float] = None
    room: Optional[str] = None
    subcategory: Optional[str] = None
    notes: Optional[str] = None


class EstimateItemOut(BaseModel):
    id: int
    name: str
    qty: int
    weight_lbs: float
    cubic_ft: float
    room: Optional[str] = None
    subcategory: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


class CatalogItemIn(BaseModel):
    name: str
    weight_lbs: float = 0
    cubic_ft: float = 0
    category: Optional[str] = None


class CatalogItemOut(BaseModel):
    id: int
    name: str
    weight_lbs: float
    cubic_ft: float
    category: Optional[str] = None

    class Config:
        from_attributes = True


class EstimateCreate(BaseModel):
    estimate_uuid: str
    customer_name: str
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    origin_address: Optional[str] = None
    destination_address: Optional[str] = None
    move_date: Optional[str] = None
    origin_access_notes: Optional[str] = None
    destination_access_notes: Optional[str] = None
    special_items_notes: Optional[str] = None
    general_notes: Optional[str] = None


class EstimateUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    customer_phone: Optional[str] = None
    origin_address: Optional[str] = None
    destination_address: Optional[str] = None
    move_date: Optional[str] = None
    origin_access_notes: Optional[str] = None
    destination_access_notes: Optional[str] = None
    special_items_notes: Optional[str] = None
    general_notes: Optional[str] = None


class EstimateResponse(BaseModel):
    id: int
    estimate_uuid: str
    created_by_id: Optional[int]
    created_by_name: Optional[str]
    customer_name: str
    customer_email: Optional[str]
    customer_phone: Optional[str]
    origin_address: Optional[str]
    destination_address: Optional[str]
    move_date: Optional[str]
    origin_access_notes: Optional[str]
    destination_access_notes: Optional[str]
    special_items_notes: Optional[str]
    general_notes: Optional[str]
    estimated_weight_lbs: float
    estimated_cubic_ft: float
    created_at: datetime
    updated_at: datetime
    items: List[EstimateItemOut] = []

    class Config:
        from_attributes = True
