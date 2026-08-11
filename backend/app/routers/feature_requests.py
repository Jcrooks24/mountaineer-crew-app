"""
Feature request router - /api/feature-request.

Crew suggest a feature or improvement: a short title, a description, and optional
screenshots. Idempotent upsert by request_uuid (the offline queue retries with
the same id). Screenshots upload one at a time to Drive and the returned URL is
stored on the request. Every write re-exports to the FeatureRequests sheet tab,
which the nightly crew-feedback email reads. Mirrors bug_reports.
"""

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_admin
from app.db.session import get_db
from app.db.models.feature_request import FeatureRequest
from app.db.models.user import User
from app.integrations.drive_upload import upload_photo_to_drive
from app.integrations.sheets_export import schedule_feature_request_export

router = APIRouter(prefix="/api/feature-request", tags=["feature-request"])


class FeatureRequestIn(BaseModel):
    request_uuid: str
    title: Optional[str] = None
    description: str = ""
    screenshot_urls: List[str] = []


class FeatureRequestOut(BaseModel):
    request_uuid: str
    title: Optional[str] = None
    description: str
    screenshot_urls: List[str] = []
    submitted_by_name: Optional[str] = None
    created_at: Optional[str] = None


def _to_out(r: FeatureRequest) -> FeatureRequestOut:
    try:
        urls = json.loads(r.screenshot_urls or "[]")
    except Exception:
        urls = []
    return FeatureRequestOut(
        request_uuid=r.request_uuid,
        title=r.title,
        description=r.description or "",
        screenshot_urls=[u for u in urls if isinstance(u, str)],
        submitted_by_name=r.submitted_by_name,
        created_at=r.created_at.isoformat() if r.created_at else None,
    )


@router.post("/screenshot")
def upload_screenshot(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload one feature-request screenshot/mockup to Drive and return its URL.
    A failure is a real 502 (retryable), not a silent success."""
    try:
        result = upload_photo_to_drive(
            db=db,
            file_obj=file.file,
            filename=file.filename or "feature.jpg",
            mime_type=file.content_type or "image/jpeg",
            job_name="Feature Requests",
            job_date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            caption=f"Feature request - {current_user.name or current_user.email}",
        )
    except Exception as e:  # noqa: BLE001 - upstream Drive failure is retryable
        raise HTTPException(status_code=502, detail=f"Screenshot upload failed: {e}")
    return {"ok": True, "url": result.get("url") or result.get("drive_url", ""), "drive_id": result.get("file_id", "")}


@router.post("", response_model=FeatureRequestOut, status_code=201)
def create_feature_request(
    body: FeatureRequestIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.request_uuid.strip():
        raise HTTPException(status_code=400, detail="request_uuid required")
    if not (body.description or "").strip():
        raise HTTPException(status_code=400, detail="Description required")

    now = datetime.now(timezone.utc)
    row = db.query(FeatureRequest).filter(FeatureRequest.request_uuid == body.request_uuid).first()
    if row is None:
        row = FeatureRequest(request_uuid=body.request_uuid.strip(), created_at=now)
        db.add(row)

    row.title = (body.title or "").strip() or None
    row.description = (body.description or "").strip()
    row.screenshot_urls = json.dumps([u for u in body.screenshot_urls if isinstance(u, str) and u.strip()])
    row.submitted_by_id = current_user.id
    row.submitted_by_name = current_user.name or current_user.email
    row.updated_at = now

    db.commit()
    db.refresh(row)
    schedule_feature_request_export(row.request_uuid)
    return _to_out(row)


@router.get("", response_model=List[FeatureRequestOut])
def list_feature_requests(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(FeatureRequest).order_by(FeatureRequest.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]
