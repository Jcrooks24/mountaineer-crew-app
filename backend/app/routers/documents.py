from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_admin
from app.db.models.document import Document
from app.db.models.user import User
from app.db.session import get_db
from app.integrations.drive_upload import delete_drive_file, upload_file_to_drive
from app.schemas.document import DocumentResponse

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("", response_model=List[DocumentResponse])
def list_documents(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = db.query(Document).order_by(Document.category.asc(), Document.created_at.desc()).all()
    return rows


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(...),
    category: str = Form(default="general"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    data = await file.read()
    mime_type = file.content_type or "application/octet-stream"
    filename = file.filename or "document"

    try:
        result = upload_file_to_drive(
            db=db,
            file_data=data,
            filename=filename,
            mime_type=mime_type,
            category=category,
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Drive upload failed: {e}")

    row = Document(
        title=title.strip(),
        category=(category or "general").strip() or "general",
        filename=filename,
        mime_type=mime_type,
        drive_file_id=result["file_id"],
        drive_url=result["url"],
        uploaded_by_id=admin.id,
        uploaded_by_name=admin.name or admin.email or "",
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{doc_id}", status_code=204)
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    row = db.query(Document).filter(Document.id == doc_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        delete_drive_file(db, row.drive_file_id)
    except Exception:
        # Drive delete failures shouldn't block DB cleanup — trash can be purged later
        traceback.print_exc()
    db.delete(row)
    db.commit()
