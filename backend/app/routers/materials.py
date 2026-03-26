from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import List, Optional

from app.db.session import get_db
from app.integrations.sheets_export import export_materials_to_sheets

router = APIRouter(prefix="/api", tags=["materials"])


class MaterialLineItem(BaseModel):
    id: str
    name: str
    qty: float
    unitPrice: Optional[float] = None
    source: str
    baseCost: Optional[float] = None


class MaterialsSubmissionIn(BaseModel):
    id: str
    created_at: str
    job_uuid: str
    jobLabel: Optional[str] = ""
    jobName: Optional[str] = ""
    jobDate: Optional[str] = ""
    notes: Optional[str] = ""
    items: List[MaterialLineItem]
    total: float


@router.post("/materials")
def submit_materials(payload: MaterialsSubmissionIn, db: Session = Depends(get_db)):
    sheets_exported = 0
    sheets_error = None

    try:
        sheets_exported = export_materials_to_sheets(db, payload.dict())
    except Exception as ex:
        sheets_error = str(ex)

    return {
        "ok": True,
        "sheets_exported": sheets_exported,
        "sheets_error": sheets_error,
    }
