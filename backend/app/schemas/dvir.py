from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class DVIRCreate(BaseModel):
    dvir_id: str
    vehicle_number: str
    trailer_number: Optional[str] = None
    odometer: Optional[int] = None
    inspection_type: str          # "pre-trip" | "post-trip"
    inspection_date: str          # YYYY-MM-DD
    job_uuid: Optional[str] = None
    job_id: Optional[int] = None
    defects: List[str] = []       # list of defect category names
    defect_notes: Optional[str] = None
    condition: str = "satisfactory"
    back_of_truck_confirmed: Optional[bool] = None
    overnight_hold: Optional[bool] = None
    driver_name: str
    driver_signature: str         # base64 PNG data URL
    driver_signed_at: datetime


class MechanicSignRequest(BaseModel):
    mechanic_name: str
    mechanic_signature: str       # base64 PNG data URL
    repairs_made: bool
    mechanic_notes: Optional[str] = None


class MechanicSignatureEmailRequest(BaseModel):
    """Admin asks the server to email a remote sign-off link to a mechanic."""
    mechanic_email: str
    mechanic_name: Optional[str] = None


class MechanicReviewResponse(BaseModel):
    """Trimmed DVIR view returned to a remote mechanic over the token-scoped
    public endpoint. Deliberately omits driver/mechanic signature images and
    internal ids — the mechanic only needs the inspection facts to decide."""
    dvir_id: str
    vehicle_number: str
    trailer_number: Optional[str]
    odometer: Optional[int]
    inspection_type: str
    inspection_date: str
    defects: List[str]
    defect_notes: Optional[str]
    condition: str
    driver_name: str
    created_at: datetime
    already_signed: bool
    needs_mechanic_review: bool


class DVIRResponse(BaseModel):
    id: int
    dvir_id: str
    vehicle_number: str
    trailer_number: Optional[str]
    odometer: Optional[int]
    inspection_type: str
    inspection_date: str
    job_uuid: Optional[str]
    job_id: Optional[int]
    defects: List[str]
    defect_notes: Optional[str]
    condition: str
    back_of_truck_confirmed: Optional[bool] = None
    overnight_hold: Optional[bool] = None
    driver_id: Optional[int]
    driver_name: str
    driver_signature: str
    driver_signed_at: datetime
    mechanic_id: Optional[int]
    mechanic_name: Optional[str]
    mechanic_signature: Optional[str]
    mechanic_signed_at: Optional[datetime]
    repairs_made: Optional[bool]
    mechanic_notes: Optional[str]
    mechanic_signature_requested_at: Optional[datetime] = None
    mechanic_signature_requested_email: Optional[str] = None
    created_at: datetime
    needs_mechanic_review: bool = False

    class Config:
        from_attributes = True
