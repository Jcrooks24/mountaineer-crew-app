"""
Employee tags router.

Admin-only CRUD for the master tag list, plus per-user tag assignment.
Used by the Admin → Employees tab (assignment) and Admin → Settings tab
(tag list management).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.db.models.employee_tag import EmployeeTag, user_employee_tags
from app.db.models.user import User


router = APIRouter(prefix="/api/admin/employee-tags", tags=["employee-tags"])


class TagOut(BaseModel):
    id: int
    name: str
    sort_order: int

    class Config:
        from_attributes = True


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    sort_order: Optional[int] = None


class TagUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    sort_order: Optional[int] = None


def _to_out(t: EmployeeTag) -> TagOut:
    return TagOut(id=t.id, name=t.name, sort_order=t.sort_order)


# ── Tag list CRUD ────────────────────────────────────────────────────────────


@router.get("", response_model=List[TagOut])
def list_tags(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        db.query(EmployeeTag)
        .order_by(EmployeeTag.sort_order.asc(), EmployeeTag.name.asc())
        .all()
    )
    return [_to_out(t) for t in rows]


@router.post("", response_model=TagOut, status_code=201)
def create_tag(
    body: TagCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    name = body.name.strip()
    existing = db.query(EmployeeTag).filter(EmployeeTag.name == name).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Tag '{name}' already exists")
    now = datetime.now(timezone.utc)
    # Default sort_order = current max + 1 so new tags land at the end of the
    # admin-managed list instead of silently shuffling into the middle.
    if body.sort_order is None:
        current_max = (
            db.query(EmployeeTag).order_by(EmployeeTag.sort_order.desc()).first()
        )
        sort_order = (current_max.sort_order + 1) if current_max else 0
    else:
        sort_order = body.sort_order
    tag = EmployeeTag(
        name=name, sort_order=sort_order, created_at=now, updated_at=now
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _to_out(tag)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: int,
    body: TagUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(EmployeeTag).filter(EmployeeTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if body.name is not None:
        new_name = body.name.strip()
        clash = (
            db.query(EmployeeTag)
            .filter(EmployeeTag.name == new_name, EmployeeTag.id != tag_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Tag '{new_name}' already exists")
        tag.name = new_name
    if body.sort_order is not None:
        tag.sort_order = body.sort_order
    tag.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(tag)
    return _to_out(tag)


@router.delete("/{tag_id}", status_code=204)
def delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    tag = db.query(EmployeeTag).filter(EmployeeTag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    # ON DELETE CASCADE on user_employee_tags handles the assignment cleanup.
    db.delete(tag)
    db.commit()
    return None


# ── Per-user assignment ──────────────────────────────────────────────────────


class UserTagAssignment(BaseModel):
    tag_ids: List[int]


def _user_tag_ids(db: Session, user_id: int) -> List[int]:
    rows = db.execute(
        select(user_employee_tags.c.tag_id).where(
            user_employee_tags.c.user_id == user_id
        )
    ).all()
    return [r[0] for r in rows]


# Mounted under a different prefix because it's per-user — but the auth
# requirement is the same. Kept in this module so the tag logic stays in
# one place.
users_router = APIRouter(prefix="/api/admin/users", tags=["employee-tags"])


@users_router.get("/{user_id}/employee-tags", response_model=List[int])
def get_user_tags(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_tag_ids(db, user_id)


@users_router.put("/{user_id}/employee-tags", response_model=List[int])
def set_user_tags(
    user_id: int,
    body: UserTagAssignment,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Validate all incoming tag IDs exist before mutating anything — a single
    # bad ID drops the whole request so we never half-apply.
    if body.tag_ids:
        found = (
            db.query(EmployeeTag.id)
            .filter(EmployeeTag.id.in_(body.tag_ids))
            .all()
        )
        found_ids = {row[0] for row in found}
        missing = [t for t in body.tag_ids if t not in found_ids]
        if missing:
            raise HTTPException(
                status_code=400, detail=f"Unknown tag ids: {missing}"
            )

    # Replace-style write: delete the user's existing rows, insert the new set.
    db.execute(
        user_employee_tags.delete().where(
            user_employee_tags.c.user_id == user_id
        )
    )
    if body.tag_ids:
        db.execute(
            user_employee_tags.insert(),
            [{"user_id": user_id, "tag_id": tid} for tid in set(body.tag_ids)],
        )
    db.commit()
    return _user_tag_ids(db, user_id)
