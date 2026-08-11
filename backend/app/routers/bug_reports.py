"""
Bug report router - /api/bug-report.

Crew report an app bug: a description, the date it occurred, and screenshot
Drive links. Idempotent upsert by bug_uuid (the offline queue retries with the
same id). Screenshots upload one at a time to Drive and the returned URL is
stored on the report. Every write re-exports to the Bugs sheet tab, which the
nightly crew-feedback email reads.
"""

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_admin
from app.db.session import get_db
from app.db.models.bug_report import BugReport
from app.db.models.user import User
from app.integrations.drive_upload import upload_photo_to_drive
from app.integrations.sheets_export import schedule_bug_report_export

router = APIRouter(prefix="/api/bug-report", tags=["bug-report"])


class BugReportIn(BaseModel):
    bug_uuid: str
    description: str = ""
    occurred_date: Optional[str] = None
    screenshot_urls: List[str] = []


class BugReportOut(BaseModel):
    bug_uuid: str
    description: str
    occurred_date: Optional[str] = None
    screenshot_urls: List[str] = []
    submitted_by_name: Optional[str] = None
    created_at: Optional[str] = None


def _to_out(r: BugReport) -> BugReportOut:
    try:
        urls = json.loads(r.screenshot_urls or "[]")
    except Exception:
        urls = []
    return BugReportOut(
        bug_uuid=r.bug_uuid,
        description=r.description or "",
        occurred_date=r.occurred_date,
        screenshot_urls=[u for u in urls if isinstance(u, str)],
        submitted_by_name=r.submitted_by_name,
        created_at=r.created_at.isoformat() if r.created_at else None,
    )


@router.post("/screenshot")
def upload_screenshot(
    file: UploadFile = File(...),
    occurred_date: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload one bug screenshot to Drive and return its URL. The crew form
    calls this per image, then POSTs the report with the collected URLs. Failing
    here is a real 502 (retryable) rather than a silent success - the offline
    queue keeps the blob and retries."""
    try:
        result = upload_photo_to_drive(
            db=db,
            file_obj=file.file,
            filename=file.filename or "screenshot.jpg",
            mime_type=file.content_type or "image/jpeg",
            job_name="Bug Reports",
            job_date=(occurred_date or "").strip() or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            caption=f"Bug screenshot - {current_user.name or current_user.email}",
        )
    except Exception as e:  # noqa: BLE001 - upstream Drive failure is retryable
        raise HTTPException(status_code=502, detail=f"Screenshot upload failed: {e}")
    return {"ok": True, "url": result.get("url") or result.get("drive_url", ""), "drive_id": result.get("file_id", "")}


@router.post("", response_model=BugReportOut, status_code=201)
def create_bug_report(
    body: BugReportIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.bug_uuid.strip():
        raise HTTPException(status_code=400, detail="bug_uuid required")
    if not (body.description or "").strip():
        raise HTTPException(status_code=400, detail="Description required")

    # Idempotent: the offline queue retries with the same uuid. Update the
    # existing row rather than duplicating (also lets a re-submit backfill
    # screenshot URLs that finished uploading after the first POST).
    now = datetime.now(timezone.utc)
    row = db.query(BugReport).filter(BugReport.bug_uuid == body.bug_uuid).first()
    if row is None:
        row = BugReport(bug_uuid=body.bug_uuid.strip(), created_at=now)
        db.add(row)

    row.description = (body.description or "").strip()
    row.occurred_date = (body.occurred_date or "").strip() or None
    row.screenshot_urls = json.dumps([u for u in body.screenshot_urls if isinstance(u, str) and u.strip()])
    row.submitted_by_id = current_user.id
    row.submitted_by_name = current_user.name or current_user.email
    row.updated_at = now

    db.commit()
    db.refresh(row)
    schedule_bug_report_export(row.bug_uuid)
    return _to_out(row)


@router.get("", response_model=List[BugReportOut])
def list_bug_reports(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = db.query(BugReport).order_by(BugReport.created_at.desc()).limit(500).all()
    return [_to_out(r) for r in rows]
