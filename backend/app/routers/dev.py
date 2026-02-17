"""
Dev-only endpoints (seed data).
Remove before production.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.db.models.job import Job
from app.db.models.user import User

router = APIRouter(prefix="/dev", tags=["dev"])


@router.post("/seed-jobs")
def seed_jobs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Inserts a few sample jobs if DB is empty-ish.
    """
    existing = db.query(Job).count()
    if existing > 0:
        return {"ok": True, "message": f"Jobs already exist (count={existing})."}

    now = datetime.now(timezone.utc)

    samples = [
        Job(
            external_job_id="SM-1001",
            client_name="Smith",
            origin_address="111 Kennedy St",
            destination_address="222 Main St",
            scheduled_start=now + timedelta(days=1),
        ),
        Job(
            external_job_id="SM-1002",
            client_name="Johnson",
            origin_address="5 River Rd",
            destination_address="88 Pine Ave",
            scheduled_start=now + timedelta(days=2),
        ),
        Job(
            external_job_id="SM-1003",
            client_name="Belgrade City Hall",
            origin_address="Airport location",
            destination_address="Belgrade City Hall",
            scheduled_start=now + timedelta(days=3),
        ),
    ]

    db.add_all(samples)
    db.commit()

    return {"ok": True, "inserted": len(samples)}
