"""
Driver Qualification (DQ) file router (C4.1).

The DQ repository: per-driver documents, one current copy per type (most-recent
replaces in place, old Drive file deleted). Drivers upload/read their own file
and see what is still missing; admins upload on a driver's behalf (and fill the
admin-audience forms), see every driver's file, and edit the type catalog.

In-app fillable forms (structured form -> generated PDF) come later; this phase
stores whatever PDF is uploaded, which also lets any form be filed as a scan now.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.core.dq_doc_types import (
    AUDIENCES,
    DQ_DOC_TYPES_KEY,
    default_types,
    normalize_types,
)
from app.db.models.dq_document import DqDocument
from app.db.models.system_config import SystemConfig
from app.db.models.user import User
from app.integrations.drive_upload import delete_drive_file, upload_file_to_drive

router = APIRouter(prefix="/api/dq", tags=["dq"])
admin_router = APIRouter(prefix="/api/admin/dq", tags=["dq"])

# DQ scans can be a few MB (a phone photo of a medical card); cap to keep a
# stray huge upload off the worker. The global body limit still applies too.
MAX_DQ_BYTES = 20 * 1024 * 1024


def _load_types(db: Session) -> List[Dict[str, Any]]:
    row = db.query(SystemConfig).filter(SystemConfig.key == DQ_DOC_TYPES_KEY).first()
    types = normalize_types(json.loads(row.value)) if row and row.value else default_types()
    return types or default_types()


def _doc_out(d: Optional[DqDocument]) -> Optional[Dict[str, Any]]:
    if d is None:
        return None
    return {
        "doc_type": d.doc_type,
        "doc_name": d.doc_name,
        "drive_url": d.drive_url,
        "filename": d.filename,
        "submitted_by_name": d.submitted_by_name,
        "submitted_at": d.submitted_at.isoformat() if d.submitted_at else None,
    }


def _do_upload(
    db: Session, file: UploadFile, user_id: int, doc_type: str, submitter: User,
) -> DqDocument:
    types = _load_types(db)
    t = next((x for x in types if x["key"] == doc_type), None)
    if t is None:
        raise HTTPException(status_code=400, detail="Unknown document type")
    driver = db.query(User).filter(User.id == user_id).first()
    if driver is None:
        raise HTTPException(status_code=404, detail="Driver not found")

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_DQ_BYTES:
        raise HTTPException(status_code=413, detail="File too large (20 MB max)")

    result = upload_file_to_drive(
        db,
        BytesIO(content),
        file.filename or f"{doc_type}.pdf",
        file.content_type or "application/pdf",
        category=f"DQ - {driver.name or driver.email}",
    )

    now = datetime.now(timezone.utc)

    def _find():
        return (
            db.query(DqDocument)
            .filter(DqDocument.user_id == user_id, DqDocument.doc_type == doc_type)
            .first()
        )

    def _apply(r: DqDocument) -> None:
        r.doc_name = t["name"]
        r.drive_file_id = result["file_id"]
        r.drive_url = result.get("url", "")
        r.filename = file.filename
        r.status = "submitted"
        r.submitted_by_id = submitter.id
        r.submitted_by_name = submitter.name or submitter.email
        r.submitted_at = now
        r.updated_at = now

    row = _find()
    old_file_id = row.drive_file_id if row else None
    if row is None:
        row = DqDocument(user_id=user_id, doc_type=doc_type, submitted_at=now)
        db.add(row)
    _apply(row)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent upload for the same (driver, type) won the insert race.
        # Adopt the existing row and point it at the file we just uploaded; its
        # previous file becomes the old_file_id we delete below.
        db.rollback()
        row = _find()
        if row is None:
            raise HTTPException(status_code=409, detail="document conflict, retry")
        old_file_id = row.drive_file_id
        _apply(row)
        db.commit()
    db.refresh(row)

    # Most-recent-wins: drop the previous file so the DQ file holds one copy.
    if old_file_id and old_file_id != result["file_id"]:
        try:
            delete_drive_file(db, old_file_id)
        except Exception as exc:
            print(f"[dq] old file delete failed ({old_file_id}): {exc}")
    return row


def _file_view(db: Session, user: User, admin_view: bool) -> Dict[str, Any]:
    """A driver's whole DQ file: every type, with its document (or None) and
    whether it is missing. `missing_required` powers the reminder; for a driver
    it counts only the documents they are responsible for."""
    docs = db.query(DqDocument).filter(DqDocument.user_id == user.id).all()
    by_type = {d.doc_type: d for d in docs}
    types = _load_types(db)
    items = [
        {
            "key": t["key"],
            "name": t["name"],
            "audience": t["audience"],
            "required": t["required"],
            "document": _doc_out(by_type.get(t["key"])),
            "missing": t["key"] not in by_type,
        }
        for t in types
    ]
    missing_required = [
        t["name"]
        for t in types
        if t["required"]
        and t["key"] not in by_type
        and (admin_view or t["audience"] == "driver")
    ]
    return {
        "user_id": user.id,
        "name": user.name or user.email,
        "types": items,
        "missing_required": missing_required,
    }


# ── Driver-facing ────────────────────────────────────────────────────────────

@router.get("/my")
def my_dq_file(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return _file_view(db, current_user, admin_view=False)


@router.post("/my/upload")
def my_dq_upload(
    file: UploadFile = File(...),
    doc_type: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """A driver uploads one of their own DQ documents. Restricted to
    driver-audience types - the admin forms are filed by the office."""
    types = _load_types(db)
    t = next((x for x in types if x["key"] == doc_type), None)
    if t is None:
        raise HTTPException(status_code=400, detail="Unknown document type")
    if t["audience"] != "driver":
        raise HTTPException(status_code=403, detail="This document is filed by the office, not the driver")
    row = _do_upload(db, file, current_user.id, doc_type, current_user)
    return {"document": _doc_out(row)}


# ── Admin-facing ─────────────────────────────────────────────────────────────

@admin_router.get("")
def admin_dq_overview(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    """One row per active driver: how many required documents are still missing.
    The office's at-a-glance DQ status board."""
    types = _load_types(db)
    required_keys = {t["key"] for t in types if t["required"]}
    users = db.query(User).filter(User.is_active.is_(True)).all()
    have_rows = db.query(DqDocument.user_id, DqDocument.doc_type).all()
    have: Dict[int, set] = {}
    for uid, dt in have_rows:
        have.setdefault(uid, set()).add(dt)
    out = []
    for u in sorted(users, key=lambda x: (x.name or x.email or "").lower()):
        got = have.get(u.id, set())
        missing = [k for k in required_keys if k not in got]
        out.append({
            "user_id": u.id,
            "name": u.name or u.email,
            "missing_count": len(missing),
            "required_count": len(required_keys),
        })
    return {"drivers": out, "required_count": len(required_keys)}


@admin_router.get("/{user_id}")
def admin_dq_file(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Driver not found")
    return _file_view(db, user, admin_view=True)


@admin_router.post("/upload")
def admin_dq_upload(
    file: UploadFile = File(...),
    user_id: int = Form(...),
    doc_type: str = Form(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Dict[str, Any]:
    """Admin files any document for any driver (including the admin-audience
    road-test forms, and scans on a driver's behalf)."""
    row = _do_upload(db, file, user_id, doc_type, admin)
    return {"document": _doc_out(row)}


# ── Type catalog (config) ────────────────────────────────────────────────────

@router.get("/doc-types")
def get_doc_types(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """The DQ type catalog, readable by any signed-in user so a driver knows
    what their file needs."""
    return {"types": _load_types(db)}


class DqTypeIn(BaseModel):
    key: Optional[str] = None
    name: str
    audience: str = "driver"
    required: bool = True


class DqTypesRequest(BaseModel):
    types: List[DqTypeIn]


@admin_router.get("/config/types")
def admin_get_doc_types(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> Dict[str, Any]:
    return {"types": _load_types(db), "audiences": list(AUDIENCES)}


@admin_router.put("/config/types", status_code=204)
def admin_set_doc_types(
    payload: DqTypesRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    types = normalize_types([t.model_dump() for t in payload.types])
    if not types:
        raise HTTPException(status_code=400, detail="At least one document type is required")
    row = db.query(SystemConfig).filter(SystemConfig.key == DQ_DOC_TYPES_KEY).first()
    if row:
        row.value = json.dumps(types)
    else:
        db.add(SystemConfig(key=DQ_DOC_TYPES_KEY, value=json.dumps(types)))
    db.commit()
