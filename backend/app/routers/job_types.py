"""
Job types router.

Admin CRUD for the configurable job-type tag list (Settings tab), plus a
crew-facing GET so the Job Report can render the current tags. Replaces the
old hardcoded JOB_TYPE_TAGS vocabulary.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.db.models.job_type import JobType
from app.db.models.user import User


# Crew-facing: any authenticated user can read the active list.
public_router = APIRouter(prefix="/api/job-types", tags=["job-types"])
# Admin-only CRUD.
admin_router = APIRouter(prefix="/api/admin/job-types", tags=["job-types"])


class JobTypeOut(BaseModel):
    id: int
    name: str
    sort_order: int
    active: bool

    class Config:
        from_attributes = True


class JobTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    sort_order: Optional[int] = None


class JobTypeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    sort_order: Optional[int] = None
    active: Optional[bool] = None


@public_router.get("", response_model=List[JobTypeOut])
def list_active_job_types(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(JobType)
        .filter(JobType.active.is_(True))
        .order_by(JobType.sort_order.asc(), JobType.name.asc())
        .all()
    )
    return rows


@admin_router.get("", response_model=List[JobTypeOut])
def list_job_types(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        db.query(JobType)
        .order_by(JobType.sort_order.asc(), JobType.name.asc())
        .all()
    )
    return rows


@admin_router.post("", response_model=JobTypeOut, status_code=201)
def create_job_type(
    body: JobTypeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    name = body.name.strip()
    if db.query(JobType).filter(JobType.name == name).first():
        raise HTTPException(status_code=409, detail=f"Job type '{name}' already exists")
    now = datetime.now(timezone.utc)
    if body.sort_order is None:
        current_max = db.query(JobType).order_by(JobType.sort_order.desc()).first()
        sort_order = (current_max.sort_order + 1) if current_max else 0
    else:
        sort_order = body.sort_order
    jt = JobType(name=name, sort_order=sort_order, active=True, created_at=now, updated_at=now)
    db.add(jt)
    db.commit()
    db.refresh(jt)
    return jt


@admin_router.patch("/{job_type_id}", response_model=JobTypeOut)
def update_job_type(
    job_type_id: int,
    body: JobTypeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    jt = db.query(JobType).filter(JobType.id == job_type_id).first()
    if not jt:
        raise HTTPException(status_code=404, detail="Job type not found")
    if body.name is not None:
        new_name = body.name.strip()
        clash = (
            db.query(JobType)
            .filter(JobType.name == new_name, JobType.id != job_type_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Job type '{new_name}' already exists")
        jt.name = new_name
    if body.sort_order is not None:
        jt.sort_order = body.sort_order
    if body.active is not None:
        jt.active = body.active
    jt.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(jt)
    return jt


@admin_router.delete("/{job_type_id}", status_code=204)
def delete_job_type(
    job_type_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    jt = db.query(JobType).filter(JobType.id == job_type_id).first()
    if not jt:
        raise HTTPException(status_code=404, detail="Job type not found")
    db.delete(jt)
    db.commit()
    return None
