"""
Public config router — no auth required.

Endpoints:
- GET /api/config/theme  — returns the admin-saved app theme (or null if not set)
"""

import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.system_config import SystemConfig

router = APIRouter(prefix="/api/config", tags=["config"])

APP_THEME_KEY = "app_theme"


@router.get("/theme")
def get_app_theme(db: Session = Depends(get_db)):
    row = db.query(SystemConfig).filter(SystemConfig.key == APP_THEME_KEY).first()
    if not row or not row.value:
        return None
    return json.loads(row.value)
