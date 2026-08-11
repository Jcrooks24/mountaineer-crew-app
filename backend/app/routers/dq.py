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
from datetime import datetime, timedelta, timezone
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
from app.integrations.drive_upload import (
    delete_drive_file,
    sweep_dq_orphans,
    upload_dq_file_to_drive,
)

router = APIRouter(prefix="/api/dq", tags=["dq"])
admin_router = APIRouter(prefix="/api/admin/dq", tags=["dq"])

# DQ scans can be a few MB (a phone photo of a medical card); cap to keep a
# stray huge upload off the worker. The global body limit still applies too.
MAX_DQ_BYTES = 20 * 1024 * 1024

# How far before a renewal-cadence doc lapses to start reminding the driver.
# ~2 weeks (so the annual certification resurfaces around week 51 of 52).
RENEWAL_LEAD_DAYS = 14


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

    # The driver's folder is named for the driver, not the doc. Any existing row
    # of theirs carries the folder ID from a previous submission; the first
    # submission has none and creates the folder. Addressing it by ID afterwards
    # is what keeps a rename from splitting their compliance file in two.
    known_folder_id = (
        db.query(DqDocument.drive_folder_id)
        .filter(
            DqDocument.user_id == user_id,
            DqDocument.drive_folder_id.isnot(None),
        )
        .limit(1)
        .scalar()
    )

    result = upload_dq_file_to_drive(
        db,
        BytesIO(content),
        file.filename or f"{doc_type}.pdf",
        file.content_type or "application/pdf",
        driver_folder_name=driver.name or driver.email,
        known_folder_id=known_folder_id,
        doc_type=doc_type,
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
        r.drive_folder_id = result.get("folder_id")
        r.filename = file.filename
        r.status = "submitted"
        r.submitted_by_id = submitter.id
        r.submitted_by_name = submitter.name or submitter.email
        r.submitted_at = now
        r.updated_at = now

    # The Drive upload above already happened. From here to the commit, ANY
    # failure leaves a file in the driver's folder that no row points at: the
    # app still reports the document missing, the driver uploads again, and the
    # orphan is never cleaned up because the most-recent-wins delete below keys
    # off a row that does not exist. Compensate by deleting what we just
    # uploaded before re-raising, so a handled failure leaves no litter.
    def _drop_uploaded(reason: str) -> None:
        try:
            delete_drive_file(db, result["file_id"])
        except Exception as exc:  # noqa: BLE001 - best effort cleanup
            print(f"[dq] orphan cleanup failed after {reason} ({result['file_id']}): {exc}")

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
            _drop_uploaded("insert race with no winner")
            raise HTTPException(status_code=409, detail="document conflict, retry")
        old_file_id = row.drive_file_id
        _apply(row)
        try:
            db.commit()
        except Exception:
            db.rollback()
            _drop_uploaded("commit failed after adopting the race winner")
            raise
    except Exception:
        db.rollback()
        _drop_uploaded("commit failed")
        raise
    db.refresh(row)

    # Most-recent-wins: drop the previous file so the DQ file holds one copy.
    if old_file_id and old_file_id != result["file_id"]:
        try:
            delete_drive_file(db, old_file_id)
        except Exception as exc:
            print(f"[dq] old file delete failed ({old_file_id}): {exc}")

    # Self-heal any orphan a previous crashed upload of this doc type left
    # behind. Runs after the commit, so the file we just recorded is safe.
    sweep_dq_orphans(db, result.get("folder_id", ""), doc_type, result["file_id"])
    return row


def is_driver(db: Session, user: User) -> bool:
    """Does this person hold a Driver employee tag?

    DQ documents are a driver obligation (49 CFR 391). Everyone else has no DQ
    file to be missing, so chasing them for a medical card is noise that trains
    people to ignore the reminder.
    """
    if user is None:
        return False
    return user.id in {u.id for u in _driver_roster(db)}


def _driver_roster(db: Session) -> List[User]:
    """Active employees tagged as drivers.

    The board used to be `User.is_active == True` with no tag filter at all, so
    every employee appeared as a driver missing every document. The docstring
    said "per active driver"; the query never said so.

    Inactive users are excluded outright: they are not employees, so they are not
    a compliance gap.

    Tag match is case-insensitive and substring-based ("Driver", "drivers",
    "CDL Driver" all count) because the tag list is admin-authored free text and
    an exact match would silently empty this board over a capital letter.
    """
    from app.db.models.employee_tag import EmployeeTag, user_employee_tags

    driver_tag_ids = [
        t.id for t in db.query(EmployeeTag).all()
        if "driver" in (t.name or "").strip().lower()
    ]
    if not driver_tag_ids:
        # No Driver tag exists yet. Return nobody rather than everybody: an empty
        # board is a visible "set up your tags" prompt, while listing all staff is
        # the bug this replaced.
        return []
    rows = db.execute(
        user_employee_tags.select().where(
            user_employee_tags.c.tag_id.in_(driver_tag_ids)
        )
    ).all()
    ids = {r.user_id for r in rows}
    if not ids:
        return []
    return (
        db.query(User)
        .filter(User.id.in_(ids), User.is_active.is_(True))
        .all()
    )


def _file_view(db: Session, user: User, admin_view: bool) -> Dict[str, Any]:
    """A driver's whole DQ file: every type, with its document (or None) and
    whether it is missing. `missing_required` powers the reminder; for a driver
    it counts only the documents they are responsible for."""
    docs = db.query(DqDocument).filter(DqDocument.user_id == user.id).all()
    by_type = {d.doc_type: d for d in docs}
    types = _load_types(db)
    now = datetime.utcnow()

    items: List[Dict[str, Any]] = []
    missing_required: List[str] = []
    for t in types:
        doc = by_type.get(t["key"])
        missing = doc is None
        # Renewal: a submitted doc that lapses on a cadence (e.g. the annual
        # certification of violations) resurfaces RENEWAL_LEAD_DAYS before it
        # expires so the driver re-files it in time.
        renewal_days = t.get("renewal_days")
        renewal_due = False
        due_date = None
        if renewal_days and doc is not None and doc.submitted_at:
            sub = doc.submitted_at
            if sub.tzinfo is not None:  # normalize to naive UTC to match `now`
                sub = sub.astimezone(timezone.utc).replace(tzinfo=None)
            due = sub + timedelta(days=int(renewal_days))
            due_date = due.date().isoformat()
            if now >= due - timedelta(days=RENEWAL_LEAD_DAYS):
                renewal_due = True
        items.append({
            "key": t["key"],
            "name": t["name"],
            "audience": t["audience"],
            "required": t["required"],
            "document": _doc_out(doc),
            "missing": missing,
            "renewal_due": renewal_due,
            "due_date": due_date,
        })
        # The reminder counts a required doc that is missing, or due for renewal.
        # Admin-audience docs (road test) count only in the admin overview - the
        # driver can't file them, so they aren't in the driver's nag count, but
        # they still show in the file card (flagged, with a "contact the office"
        # hint on the frontend).
        if t["required"] and (missing or renewal_due) and (admin_view or t["audience"] == "driver"):
            missing_required.append(t["name"])

    # A non-driver has no DQ obligation, so nothing is "missing" for them and the
    # reminder must stay silent. Their file is still returned (empty), so an admin
    # opening it sees the truth rather than a 404, and so a person who is later
    # tagged as a driver needs no migration.
    if not admin_view and not is_driver(db, user):
        missing_required = []

    return {
        "user_id": user.id,
        "name": user.name or user.email,
        "types": items,
        "missing_required": missing_required,
        "is_driver": is_driver(db, user),
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
    users = _driver_roster(db)
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
