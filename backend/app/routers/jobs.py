"""
Jobs router:
- search jobs
- validate manual job id
All endpoints are protected (JWT required).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.core.deps import get_current_user
from app.db.session import get_db
from app.db.models.job import Job
from app.db.models.user import User
from app.schemas.jobs import JobResponse

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobResponse])
def search_jobs(
    query: str = "",
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),  # auth gate
):
    q = (query or "").strip()

    base = db.query(Job)

    if q:
        like = f"%{q}%"
        base = base.filter(
            or_(
                Job.client_name.ilike(like),
                Job.origin_address.ilike(like),
                Job.destination_address.ilike(like),
                Job.external_job_id.ilike(like),
            )
        )

    # “recent first” heuristic
    jobs = base.order_by(Job.scheduled_start.desc().nullslast(), Job.id.desc()).limit(limit).all()
    return jobs


@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),  # auth gate
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
