"""Patch notes - admin authors, crew reads.

Crew can list the notes; the "new notes since last read" indicator is tracked
client-side via localStorage keyed on updated_at, so this router only needs to
serve the current state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.app_build import AppBuild
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
        build_id=(body.build_id or "").strip() or None,
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
    if body.build_id is not None:
        # "" means UNLINK. An optional field alone cannot distinguish "clear this"
        # from "leave it alone", so empty is the explicit clear and absent is the
        # no-op.
        row.build_id = body.build_id.strip() or None
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


# ── Build history ────────────────────────────────────────────────────────────

class BuildSeen(BaseModel):
    build_id: str
    version_name: str = ""


@router.post("/build-seen", status_code=status.HTTP_204_NO_CONTENT)
def record_build_seen(
    body: BuildSeen,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """A device reports the build it is running. Idempotent; called on load.

    This records builds that were REACHED BY A DEVICE, not builds that were
    deployed. That distinction is deliberate and is the useful one: a build
    nobody ever loaded is not part of the crew's history, and a build that never
    reaches a device shows up here as an absence, which is a deployment problem
    worth seeing.

    Silently ignores a blank or local build id so a dev machine cannot litter the
    production history.
    """
    build_id = (body.build_id or "").strip()
    if not build_id or build_id.startswith("dev-") or build_id == "dev":
        return
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row = db.query(AppBuild).filter(AppBuild.build_id == build_id).first()
    if row is None:
        row = AppBuild(
            build_id=build_id,
            version_name=(body.version_name or "").strip() or build_id,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(row)
    else:
        row.last_seen_at = now
    try:
        db.commit()
    except Exception:
        # Two devices reporting the same NEW build at once race on the unique
        # index. Both are right and the row exists either way, so a loser here
        # has nothing to report and nothing to retry.
        db.rollback()


@router.get("/history")
def build_history(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Builds newest-first, each with the notes linked to it, plus any notes
    that are not linked to a build at all.

    This is the "complete version history" the request asked for: a build that
    shipped WITHOUT notes still appears, as a bare line saying it happened,
    rather than leaving a silent gap between two announcements.
    """
    builds = (
        db.query(AppBuild)
        .order_by(AppBuild.first_seen_at.desc())
        .limit(100)
        .all()
    )
    notes = db.query(PatchNote).order_by(PatchNote.updated_at.desc()).limit(200).all()

    by_build: dict = {}
    unlinked = []
    for n in notes:
        key = (n.build_id or "").strip()
        if key:
            by_build.setdefault(key, []).append(n)
        else:
            unlinked.append(n)

    def _note(n: PatchNote) -> dict:
        return {
            "id": n.id,
            "title": n.title,
            "body": n.body,
            "created_by_name": n.created_by_name,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        }

    seen_keys = set()
    out = []
    for b in builds:
        seen_keys.add(b.build_id)
        out.append({
            "kind": "build",
            "build_id": b.build_id,
            "version_name": b.version_name,
            "first_seen_at": b.first_seen_at.isoformat() if b.first_seen_at else None,
            "last_seen_at": b.last_seen_at.isoformat() if b.last_seen_at else None,
            "notes": [_note(n) for n in by_build.get(b.build_id, [])],
        })

    # A note linked to a build nobody has reported yet (or one older than the
    # 100-build window) must not vanish. It renders as an unattached note rather
    # than being silently dropped, which is what a naive join would do.
    for key, ns in by_build.items():
        if key not in seen_keys:
            unlinked.extend(ns)

    return {
        "builds": out,
        "unlinked_notes": [
            _note(n) for n in sorted(
                unlinked, key=lambda n: n.updated_at or datetime.min, reverse=True,
            )
        ],
    }
