"""Admin notes — admin authors, crew reads.

Scope model:
- job_uuid == NULL  → global: every crew member sees it.
- job_uuid set      → job-specific: only surfaces when that job is selected.

Crew can list all notes (filterable by scope); writes are admin-only.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.admin_note import AdminNote
from app.db.models.user import User
from app.schemas.admin_note import AdminNoteCreate, AdminNoteResponse, AdminNoteUpdate

router = APIRouter(prefix="/api/admin-notes", tags=["admin-notes"])


def _norm_job_uuid(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    s = v.strip()
    return s or None


@router.get("", response_model=List[AdminNoteResponse])
def list_admin_notes(
    scope: Optional[str] = Query(
        default=None,
        description='"global" to return only global notes; a job_uuid to return only notes for that job; omit to return everything.',
    ),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(AdminNote)
    if scope == "global":
        q = q.filter(AdminNote.job_uuid.is_(None))
    elif scope:
        q = q.filter(AdminNote.job_uuid == scope)
    return q.order_by(AdminNote.updated_at.desc()).all()


@router.post("", response_model=AdminNoteResponse, status_code=status.HTTP_201_CREATED)
def create_admin_note(
    body: AdminNoteCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    title = body.title.strip()
    text = body.body.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    if not text:
        raise HTTPException(status_code=400, detail="Body is required.")

    now = datetime.now(timezone.utc)
    row = AdminNote(
        title=title,
        body=text,
        job_uuid=_norm_job_uuid(body.job_uuid),
        created_by_id=admin.id,
        created_by_name=admin.name or admin.email or "",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{note_id}", response_model=AdminNoteResponse)
def update_admin_note(
    note_id: int,
    body: AdminNoteUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(AdminNote).filter(AdminNote.id == note_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Admin note not found")
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be blank")
        row.title = title
    if body.body is not None:
        text = body.body.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Body cannot be blank")
        row.body = text
    if body.job_uuid is not None:
        row.job_uuid = _norm_job_uuid(body.job_uuid)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{note_id}", status_code=204)
def delete_admin_note(
    note_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(AdminNote).filter(AdminNote.id == note_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Admin note not found")
    db.delete(row)
    db.commit()
