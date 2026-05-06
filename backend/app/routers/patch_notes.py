"""Patch notes — admin authors, crew reads.

Crew can list the notes; the "new notes since last read" indicator is tracked
client-side via localStorage keyed on updated_at, so this router only needs to
serve the current state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.patch_note import PatchNote
from app.db.models.user import User
from app.schemas.patch_note import PatchNoteCreate, PatchNoteResponse, PatchNoteUpdate

router = APIRouter(prefix="/api/patch-notes", tags=["patch-notes"])


@router.get("", response_model=List[PatchNoteResponse])
def list_patch_notes(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(PatchNote)
        .order_by(PatchNote.updated_at.desc())
        .limit(200)
        .all()
    )


@router.post("", response_model=PatchNoteResponse, status_code=status.HTTP_201_CREATED)
def create_patch_note(
    body: PatchNoteCreate,
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
    row = PatchNote(
        title=title,
        body=text,
        created_by_id=admin.id,
        created_by_name=admin.name or admin.email or "",
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{note_id}", response_model=PatchNoteResponse)
def update_patch_note(
    note_id: int,
    body: PatchNoteUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(PatchNote).filter(PatchNote.id == note_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Patch note not found")
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
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{note_id}", status_code=204)
def delete_patch_note(
    note_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = db.query(PatchNote).filter(PatchNote.id == note_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Patch note not found")
    db.delete(row)
    db.commit()
