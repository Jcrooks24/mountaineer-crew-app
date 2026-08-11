"""
Public config router - no auth required.

Endpoints:
- GET /api/config/theme    - returns the admin-saved app theme (or null if not set)
- GET /api/config/company  - returns the company (carrier) info, defaults applied
"""

import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.system_config import SystemConfig
from app.core.company import COMPANY_INFO_KEY, merge_company

router = APIRouter(prefix="/api/config", tags=["config"])

APP_THEME_KEY = "app_theme"


@router.get("/theme")
def get_app_theme(db: Session = Depends(get_db)):
    row = db.query(SystemConfig).filter(SystemConfig.key == APP_THEME_KEY).first()
    if not row or not row.value:
        return None
    return json.loads(row.value)


@router.get("/company")
def get_company_info(db: Session = Depends(get_db)):
    """Company / carrier info for the crew app (BOL carrier block, etc.).
    Public so the field app can read it without an admin token; always returns a
    complete object with defaults applied for any unset field."""
    row = db.query(SystemConfig).filter(SystemConfig.key == COMPANY_INFO_KEY).first()
    stored = json.loads(row.value) if row and row.value else {}
    return merge_company(stored)


@router.get("/vehicle-units")
def get_vehicle_units(db: Session = Depends(get_db)):
    """Fleet units + their weight/dimension data (dry weight, GVWR, dims, axle
    capacities). Public so DVIR, BOLs, and the inventory weight flags can read it
    without an admin token. Returns the seeded default fleet when nothing is set."""
    from app.core.vehicle_units import VEHICLE_UNITS_KEY, normalize_units, default_units

    row = db.query(SystemConfig).filter(SystemConfig.key == VEHICLE_UNITS_KEY).first()
    if not row or not row.value:
        return {"units": default_units()}
    return {"units": normalize_units(json.loads(row.value))}


@router.get("/job-checklist")
def get_job_checklist(db: Session = Depends(get_db)):
    """The job checklist items. Public so the crew can render the checklist on a
    job without an admin token. Returns the seeded default list when unset."""
    from app.core.job_checklists import JOB_CHECKLIST_KEY, normalize_items, default_items

    row = db.query(SystemConfig).filter(SystemConfig.key == JOB_CHECKLIST_KEY).first()
    if not row or not row.value:
        return {"items": default_items()}
    items = normalize_items(json.loads(row.value))
    return {"items": items if items else default_items()}
