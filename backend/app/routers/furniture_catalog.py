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
from fastapi.responses import StreamingResponse
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
_NAME_KEYS = {"name", "item", "item_name", "furniture"}
_CUFT_KEYS = {"cubic_ft", "cuft", "cu_ft", "cubic feet", "volume", "cf"}
_WEIGHT_KEYS = {"weight_lbs", "weight", "lbs", "pounds", "wt"}
_CATEGORY_KEYS = {"category", "cat", "room", "group"}
_LENGTH_KEYS = {"length_in", "length", "len", "l", "depth"}
_WIDTH_KEYS = {"width_in", "width", "w"}
_HEIGHT_KEYS = {"height_in", "height", "h", "ht"}
_PACKING_KEYS = {"packing_type", "packing", "pack", "packing type", "handling"}
_FRAGILE_KEYS = {"fragile", "delicate", "is_fragile"}
_SKU_KEYS = {"sku", "code", "item_code", "item code", "part", "part_number"}
_NOTES_KEYS = {"notes", "note", "description", "comment", "comments", "remarks"}

# All catalog CSV columns, in export order. name is the upsert key and comes
# first; the rest are what an admin fills in the spreadsheet.
_EXPORT_HEADERS = [
    "name", "category", "length_in", "width_in", "height_in",
    "cubic_ft", "weight_lbs", "packing_type", "fragile", "sku", "notes",
]

_TRUE = {"y", "yes", "true", "1", "x", "fragile", "t"}
_FALSE = {"n", "no", "false", "0", "f"}


def _pick(row: dict, keys: set) -> Optional[str]:
    """Return the stripped cell value for the first matching header alias, or
    None if the column is absent OR present-but-blank. Callers therefore treat
    None as 'leave the existing value alone' (blank cells never overwrite)."""
    for k, v in row.items():
        if k is None:
            continue
        if k.strip().lower() in keys:
            s = (str(v).strip() if v is not None else "")
            return s or None
    return None


def _to_float(v) -> float:
    try:
        return float(str(v).replace(",", "").strip()) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _to_float_or_none(v) -> Optional[float]:
    """Parse a numeric cell; None when blank/unparseable so it doesn't overwrite."""
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _to_bool_or_none(v: Optional[str]) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    return None


def _derived_cubic_ft(length: Optional[float], width: Optional[float], height: Optional[float]) -> Optional[float]:
    """L*W*H (inches) -> cubic feet, rounded to 2dp. None unless all three > 0."""
    if length and width and height and length > 0 and width > 0 and height > 0:
        return round((length * width * height) / 1728.0, 2)
    return None


@router.post("/import-csv")
async def import_furniture_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Bulk import furniture rows from a CSV. Columns (header row,
    case-insensitive, aliases accepted): name, category, length_in, width_in,
    height_in, cubic_ft, weight_lbs, packing_type, fragile, sku, notes. Upserts
    by name.

    Only non-blank cells overwrite an existing row - so an admin can fill just
    the columns they care about and leave the rest blank without wiping data.
    When length/width/height are all present, cubic_ft is derived (L*W*H/1728)
    and takes precedence over an explicit cubic_ft cell. Returns a summary."""
    # Stream-decode straight off the upload's spooled file instead of reading the
    # whole body into a bytes buffer, decoding it into a second str copy, and
    # wrapping that in a StringIO (a third copy) - which triple-buffered a CSV
    # that can be up to the 100 MB body cap. TextIOWrapper decodes incrementally
    # as csv.DictReader pulls lines. errors="replace" keeps a stray non-UTF-8
    # byte from aborting the whole import (utf-8-sig also strips a leading BOM).
    text_stream = io.TextIOWrapper(file.file, encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(text_stream)
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV has no header row")

    added = 0
    updated = 0
    skipped = 0
    errors: List[str] = []
    now = datetime.now(timezone.utc)

    for i, row in enumerate(reader, start=2):  # row 1 is the header
        name = _pick(row, _NAME_KEYS)
        if not name:
            skipped += 1
            continue

        weight = _to_float_or_none(_pick(row, _WEIGHT_KEYS))
        length = _to_float_or_none(_pick(row, _LENGTH_KEYS))
        width = _to_float_or_none(_pick(row, _WIDTH_KEYS))
        height = _to_float_or_none(_pick(row, _HEIGHT_KEYS))
        # Dimensions win over an explicit cubic_ft when all three are given.
        cuft = _derived_cubic_ft(length, width, height)
        if cuft is None:
            cuft = _to_float_or_none(_pick(row, _CUFT_KEYS))
        category = _pick(row, _CATEGORY_KEYS)
        packing_type = _pick(row, _PACKING_KEYS)
        fragile = _to_bool_or_none(_pick(row, _FRAGILE_KEYS))
        sku = _pick(row, _SKU_KEYS)
        notes = _pick(row, _NOTES_KEYS)

        try:
            existing = db.query(FurnitureCatalogItem).filter(FurnitureCatalogItem.name == name).first()
            if existing:
                # Set each field only when its cell was provided (non-blank).
                if weight is not None:
                    existing.weight_lbs = weight
                if cuft is not None:
                    existing.cubic_ft = cuft
                if category is not None:
                    existing.category = category
                if length is not None:
                    existing.length_in = length
                if width is not None:
                    existing.width_in = width
                if height is not None:
                    existing.height_in = height
                if packing_type is not None:
                    existing.packing_type = packing_type
                if fragile is not None:
                    existing.fragile = fragile
                if sku is not None:
                    existing.sku = sku
                if notes is not None:
                    existing.notes = notes
                updated += 1
            else:
                db.add(FurnitureCatalogItem(
                    name=name,
                    weight_lbs=weight or 0.0,
                    cubic_ft=cuft or 0.0,
                    category=category,
                    length_in=length,
                    width_in=width,
                    height_in=height,
                    packing_type=packing_type,
                    fragile=fragile,
                    sku=sku,
                    notes=notes,
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


@router.get("/export-csv")
def export_furniture_csv(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Download the full catalog as a CSV whose header matches the importer, so
    admin can export -> edit in a spreadsheet -> re-upload. Streamed to keep the
    web worker's memory bounded on large catalogs."""
    def rows():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(_EXPORT_HEADERS)
        yield buf.getvalue(); buf.seek(0); buf.truncate(0)

        q = (
            db.query(FurnitureCatalogItem)
            .order_by(FurnitureCatalogItem.category.asc().nullsfirst(), FurnitureCatalogItem.name.asc())
            .yield_per(200)
        )
        for it in q:
            writer.writerow([
                it.name,
                it.category or "",
                it.length_in if it.length_in is not None else "",
                it.width_in if it.width_in is not None else "",
                it.height_in if it.height_in is not None else "",
                it.cubic_ft if it.cubic_ft is not None else "",
                it.weight_lbs if it.weight_lbs is not None else "",
                it.packing_type or "",
                "" if it.fragile is None else ("yes" if it.fragile else "no"),
                it.sku or "",
                (it.notes or "").replace("\r", " ").replace("\n", " "),
            ])
            yield buf.getvalue(); buf.seek(0); buf.truncate(0)

    headers = {"Content-Disposition": "attachment; filename=furniture_catalog.csv"}
    return StreamingResponse(rows(), media_type="text/csv", headers=headers)
