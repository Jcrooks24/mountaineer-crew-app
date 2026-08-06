"""Crew-facing per-job summary - the payload behind the closed-job panel.

Same aggregation the admin Job Summary uses (app/services/job_summary.py), minus
the admin-only sections. The crew "closed job" panel reads this to show a job whole
after close-out.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.db.models.user import User
from app.services.job_summary import build_job_summary

router = APIRouter(prefix="/api", tags=["job-summary"])


@router.get("/job-summary/{job_uuid}")
def crew_job_summary(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """Everything the app recorded for one job, minus admin-only sections
    (admin_notes, entry_status). Like the other crew job endpoints (job-setup,
    job-checklist, events, job-report) this is authenticated but not row-scoped to
    'jobs this user worked' - job_uuids are unguessable device-derived UUIDs. Do
    not add secrets to this payload."""
    return build_job_summary(db, job_uuid, include_admin=False)
