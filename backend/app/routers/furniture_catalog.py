"""
Furniture catalog (crew-readable) + admin CSV import.

The furniture_catalog table is the single server-side catalog, merged with the
built-in list on the frontend. It powers both the Estimator's item search and
the job Actual-Inventory search. Admin manages it from Settings (single adds
live on the estimates router; bulk CSV import lives here).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.estimate import FurnitureCatalogItem
from app.db.models.user import User
from app.schemas.estimate import CatalogItemOut


# Crew-readable list (any authenticated user). Admin CRUD stays on the
# estimates router; only the bulk import is added here.
router = APIRouter(prefix="/api/furniture-catalog", tags=["furniture-catalog"])


@router.get("", response_model=List[CatalogItemOut])
def list_furniture_catalog(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(FurnitureCatalogItem)
        .order_by(FurnitureCatalogItem.category.asc().nullsfirst(), FurnitureCatalogItem.name.asc())
        .limit(2000)
        .all()
    )


# Header aliases so an admin's CSV doesn't have to match exactly.
_NAME_KEYS = {"name", "item", "item_name", "furniture", "description"}
_CUFT_KEYS = {"cubic_ft", "cuft", "cu_ft", "cubic feet", "volume", "cf"}
_WEIGHT_KEYS = {"weight_lbs", "weight", "lbs", "pounds", "wt"}
_CATEGORY_KEYS = {"category", "cat", "room", "group"}


def _pick(row: dict, keys: set) -> Optional[str]:
    for k, v in row.items():
        if k is None:
            continue
        if k.strip().lower() in keys:
            return (v or "").strip() if isinstance(v, str) else v
    return None


def _to_float(v) -> float:
    try:
        return float(str(v).replace(",", "").strip()) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


@router.post("/import-csv")
async def import_furniture_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Bulk import furniture rows from a CSV. Expected columns (header row,
    case-insensitive, aliases accepted): name, cubic_ft, weight_lbs, category.
    Upserts by name. Returns a summary."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")

    added = 0
    updated = 0
    skipped = 0
    errors: List[str] = []
    now = datetime.now(timezone.utc)

    for i, row in enumerate(reader, start=2):  # row 1 is the header
        name = _pick(row, _NAME_KEYS)
        if not name or not str(name).strip():
            skipped += 1
            continue
        name = str(name).strip()
        weight = _to_float(_pick(row, _WEIGHT_KEYS))
        cuft = _to_float(_pick(row, _CUFT_KEYS))
        category = _pick(row, _CATEGORY_KEYS)
        category = (str(category).strip() or None) if category else None

        try:
            existing = db.query(FurnitureCatalogItem).filter(FurnitureCatalogItem.name == name).first()
            if existing:
                if weight > 0:
                    existing.weight_lbs = weight
                if cuft > 0:
                    existing.cubic_ft = cuft
                if category:
                    existing.category = category
                updated += 1
            else:
                db.add(FurnitureCatalogItem(
                    name=name,
                    weight_lbs=weight,
                    cubic_ft=cuft,
                    category=category,
                    created_by_id=admin.id,
                    created_at=now,
                ))
                added += 1
        except Exception as e:  # noqa: BLE001 - report row, keep importing
            errors.append(f"row {i}: {e}")

        # Commit in batches to bound memory / lock time on large files.
        if (added + updated) % 200 == 0:
            db.commit()

    db.commit()
    return {"ok": True, "added": added, "updated": updated, "skipped": skipped, "errors": errors[:20]}
