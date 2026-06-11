"""
Admin endpoints for managing crew-member email aliases.

Surfaces at /api/admin/users/{user_id}/email-aliases. All four endpoints
require admin role. Aliases are normalized to lowercase + stripped on
insert so the matching code in crew_resources_calendar.py doesn't have
to worry about casing.

Promote-to-primary is a single transaction that swaps the alias's email
with the user's current primary email on users.email — useful when the
crew member updates their preferred address.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.db.models.user import User
from app.db.models.user_email_alias import UserEmailAlias


router = APIRouter(prefix="/api/admin/users", tags=["user-email-aliases"])


class AliasOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class AliasIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)


def _normalize(email: str) -> str:
    return (email or "").strip().lower()


def _email_taken(db: Session, email: str, exclude_alias_id: Optional[int] = None) -> bool:
    """True if `email` already appears as someone's primary email or in
    user_email_aliases (excluding the optional alias being swapped)."""
    if db.query(User.id).filter(User.email == email).first():
        return True
    q = db.query(UserEmailAlias.id).filter(UserEmailAlias.email == email)
    if exclude_alias_id is not None:
        q = q.filter(UserEmailAlias.id != exclude_alias_id)
    return q.first() is not None


def _to_out(row: UserEmailAlias) -> AliasOut:
    return AliasOut(id=row.id, email=row.email, created_at=row.created_at)


@router.get("/{user_id}/email-aliases", response_model=List[AliasOut])
def list_aliases(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if not db.query(User.id).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    rows = (
        db.query(UserEmailAlias)
        .filter(UserEmailAlias.user_id == user_id)
        .order_by(UserEmailAlias.created_at.asc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/{user_id}/email-aliases", response_model=AliasOut, status_code=201)
def add_alias(
    user_id: int,
    body: AliasIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    email = _normalize(body.email)
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Not a valid email")
    if email == (user.email or "").strip().lower():
        raise HTTPException(
            status_code=409,
            detail="That's already the user's primary email",
        )
    if _email_taken(db, email):
        raise HTTPException(
            status_code=409,
            detail="That email is already in use by another crew member",
        )
    row = UserEmailAlias(
        user_id=user_id,
        email=email,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{user_id}/email-aliases/{alias_id}", status_code=204)
def remove_alias(
    user_id: int,
    alias_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    row = (
        db.query(UserEmailAlias)
        .filter(UserEmailAlias.id == alias_id, UserEmailAlias.user_id == user_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Alias not found")
    db.delete(row)
    db.commit()
    return None


@router.post("/{user_id}/email-aliases/{alias_id}/promote", response_model=AliasOut)
def promote_alias(
    user_id: int,
    alias_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Swap an alias with the user's current primary email. The promoted
    alias becomes users.email; the old primary becomes a new alias row.
    Done in one transaction so a partial failure can't leave the user
    with two primaries or none."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    alias = (
        db.query(UserEmailAlias)
        .filter(UserEmailAlias.id == alias_id, UserEmailAlias.user_id == user_id)
        .first()
    )
    if not alias:
        raise HTTPException(status_code=404, detail="Alias not found")

    new_primary = alias.email
    old_primary = (user.email or "").strip().lower()

    # Sequence: delete the alias row first so the new_primary is no longer
    # in the alias table, THEN update users.email. Otherwise the unique
    # constraint on alias.email would block step 2 (the alias still owns it
    # at that point — both as alias and primary). Insert the old primary
    # as a new alias last so it stays accessible for next time.
    db.delete(alias)
    db.flush()
    user.email = new_primary
    db.flush()
    if old_primary:
        new_alias = UserEmailAlias(
            user_id=user_id,
            email=old_primary,
            created_at=datetime.now(timezone.utc),
        )
        db.add(new_alias)
    db.commit()

    # Return the row representing the OLD primary that's now an alias —
    # the just-promoted alias no longer has a row of its own; the user
    # row holds it.
    if old_primary:
        latest = (
            db.query(UserEmailAlias)
            .filter(
                UserEmailAlias.user_id == user_id,
                UserEmailAlias.email == old_primary,
            )
            .first()
        )
        if latest:
            return _to_out(latest)
    # If there was no prior primary (shouldn't happen for an active user),
    # synthesize a response so the client gets something coherent.
    raise HTTPException(status_code=500, detail="Promotion completed but no alias row returned")
