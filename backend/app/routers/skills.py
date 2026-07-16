"""
Skills router.

- Crew-facing GET /api/skills: the active skill registry (the Job Report uses
  it to decide which skills to rate for a job's type).
- Admin CRUD /api/admin/skills: manage the registry.
- Per-user matrix /api/admin/users/{id}/skills: get/set an employee's 0-5
  levels (the roster matrix), edited in the Employees tab.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.skill import Skill, UserSkill
from app.db.models.user import User


public_router = APIRouter(prefix="/api/skills", tags=["skills"])
admin_router = APIRouter(prefix="/api/admin/skills", tags=["skills"])
users_router = APIRouter(prefix="/api/admin/users", tags=["skills"])


def _rel(raw: Optional[str]) -> List[str]:
    try:
        v = json.loads(raw or "[]")
        return [str(x) for x in v] if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


class SkillOut(BaseModel):
    id: int
    name: str
    category: str
    binary: bool
    core: bool
    relevant_job_types: List[str]
    definition: Optional[str] = None
    sort_order: int
    active: bool


def _to_out(s: Skill) -> SkillOut:
    return SkillOut(
        id=s.id,
        name=s.name,
        category=s.category or "",
        binary=bool(s.binary),
        core=bool(s.core),
        relevant_job_types=_rel(s.relevant_job_types),
        definition=s.definition,
        sort_order=s.sort_order,
        active=bool(s.active),
    )


class SkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category: str = ""
    binary: bool = False
    core: bool = False
    relevant_job_types: List[str] = []
    definition: Optional[str] = None
    sort_order: Optional[int] = None


class SkillUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    category: Optional[str] = None
    binary: Optional[bool] = None
    core: Optional[bool] = None
    relevant_job_types: Optional[List[str]] = None
    definition: Optional[str] = None
    sort_order: Optional[int] = None
    active: Optional[bool] = None


# ── Crew-facing read ─────────────────────────────────────────────────────────


@public_router.get("", response_model=List[SkillOut])
def list_active_skills(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(Skill)
        .filter(Skill.active.is_(True))
        .order_by(Skill.sort_order.asc(), Skill.name.asc())
        .all()
    )
    return [_to_out(s) for s in rows]


# ── Admin registry CRUD ──────────────────────────────────────────────────────


@admin_router.get("", response_model=List[SkillOut])
def list_skills(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.query(Skill).order_by(Skill.sort_order.asc(), Skill.name.asc()).all()
    return [_to_out(s) for s in rows]


@admin_router.post("", response_model=SkillOut, status_code=201)
def create_skill(body: SkillCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    name = body.name.strip()
    if db.query(Skill).filter(Skill.name == name).first():
        raise HTTPException(status_code=409, detail=f"Skill '{name}' already exists")
    now = datetime.now(timezone.utc)
    if body.sort_order is None:
        cur = db.query(Skill).order_by(Skill.sort_order.desc()).first()
        sort_order = (cur.sort_order + 1) if cur else 0
    else:
        sort_order = body.sort_order
    s = Skill(
        name=name,
        category=(body.category or "").strip(),
        binary=body.binary,
        core=body.core,
        relevant_job_types=json.dumps([t.strip() for t in body.relevant_job_types if t.strip()]),
        definition=(body.definition or None),
        sort_order=sort_order,
        active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_out(s)


@admin_router.patch("/{skill_id}", response_model=SkillOut)
def update_skill(skill_id: int, body: SkillUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    s = db.query(Skill).filter(Skill.id == skill_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Skill not found")
    if body.name is not None:
        new_name = body.name.strip()
        clash = db.query(Skill).filter(Skill.name == new_name, Skill.id != skill_id).first()
        if clash:
            raise HTTPException(status_code=409, detail=f"Skill '{new_name}' already exists")
        s.name = new_name
    if body.category is not None:
        s.category = body.category.strip()
    if body.binary is not None:
        s.binary = body.binary
    if body.core is not None:
        s.core = body.core
    if body.relevant_job_types is not None:
        s.relevant_job_types = json.dumps([t.strip() for t in body.relevant_job_types if t.strip()])
    if body.definition is not None:
        s.definition = body.definition or None
    if body.sort_order is not None:
        s.sort_order = body.sort_order
    if body.active is not None:
        s.active = body.active
    s.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(s)
    return _to_out(s)


@admin_router.delete("/{skill_id}", status_code=204)
def delete_skill(skill_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    s = db.query(Skill).filter(Skill.id == skill_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Skill not found")
    db.delete(s)  # ON DELETE CASCADE clears user_skills rows
    db.commit()
    return None


# ── Per-user matrix ──────────────────────────────────────────────────────────


class UserSkillLevel(BaseModel):
    skill_id: int
    level: int


class UserSkillAssignment(BaseModel):
    skills: List[UserSkillLevel]


@users_router.get("/{user_id}/skills", response_model=List[UserSkillLevel])
def get_user_skills(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.query(UserSkill).filter(UserSkill.user_id == user_id).all()
    return [UserSkillLevel(skill_id=r.skill_id, level=r.level) for r in rows]


@users_router.put("/{user_id}/skills", response_model=List[UserSkillLevel])
def set_user_skills(user_id: int, body: UserSkillAssignment, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")

    # Validate skill ids exist.
    incoming = {e.skill_id: max(0, min(5, int(e.level))) for e in body.skills}
    if incoming:
        found = {r[0] for r in db.query(Skill.id).filter(Skill.id.in_(list(incoming))).all()}
        missing = [sid for sid in incoming if sid not in found]
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown skill ids: {missing}")

    now = datetime.now(timezone.utc)
    # Upsert each level; a level of 0 with no prior row is dropped to keep the
    # matrix sparse. Existing rows set to 0 are deleted.
    existing = {r.skill_id: r for r in db.query(UserSkill).filter(UserSkill.user_id == user_id).all()}
    for sid, level in incoming.items():
        row = existing.get(sid)
        if level == 0:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            db.add(UserSkill(user_id=user_id, skill_id=sid, level=level, updated_at=now))
        else:
            row.level = level
            row.updated_at = now
    db.commit()

    rows = db.query(UserSkill).filter(UserSkill.user_id == user_id).all()
    return [UserSkillLevel(skill_id=r.skill_id, level=r.level) for r in rows]
