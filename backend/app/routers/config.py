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
