"""
Worked-hours history for the logged-in crew member.

GET /api/hours/worked-history -> weekly breakdown (regular / OT over 40 /
non-billable / other) across:
  - job-report employee hours (matched by the user's name), dated by the job's
    earliest event (Mountain time), falling back to the report's updated_at, and
  - off-job hours (matched by user id) using their work_date.

Weeks start Monday, in Mountain time. Regular vs OT is computed per week from the
billable total (job hours + off-job "regular"); anything over 40 hrs is OT.
Non-billable and "other" off-job pay structures are their own buckets and do not
count toward the 40-hour OT threshold.
"""
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.core.time_utils import utc_naive_to_mountain_date
from app.db.models.event import Event
from app.db.models.job_report import JobReport
from app.db.models.off_job_entry import OffJobEntry
from app.db.models.user import User

router = APIRouter(prefix="/api/hours", tags=["hours"])

OT_THRESHOLD = 40.0


def _week_start(d: date) -> date:
    """Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


@router.get("/worked-history")
def worked_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_name = (current_user.name or "").strip().lower()

    # --- Job-report hours (matched by employee name), summed per job_uuid ---
    job_hours: dict[str, float] = defaultdict(float)
    report_updated: dict[str, datetime] = {}
    if my_name:
        rows = db.query(
            JobReport.job_uuid, JobReport.employee_hours_json, JobReport.updated_at
        ).all()
        for job_uuid, eh_json, updated_at in rows:
            report_updated[job_uuid] = updated_at
            if not eh_json:
                continue
            try:
                entries = json.loads(eh_json)
            except Exception:
                continue
            for e in entries or []:
                if (e.get("name") or "").strip().lower() == my_name:
                    job_hours[job_uuid] += float(e.get("hours") or 0)

    # Date each job by its earliest event (Mountain date); fall back to the
    # report's updated_at when a job has no synced events.
    job_date: dict[str, date] = {}
    if job_hours:
        uuids = list(job_hours.keys())
        earliest: dict[str, datetime] = {}
        for job_uuid, ts in (
            db.query(Event.job_uuid, Event.timestamp).filter(Event.job_uuid.in_(uuids)).all()
        ):
            if ts is None:
                continue
            if job_uuid not in earliest or ts < earliest[job_uuid]:
                earliest[job_uuid] = ts
        for u in uuids:
            ts = earliest.get(u) or report_updated.get(u)
            if ts is not None:
                job_date[u] = utc_naive_to_mountain_date(ts)

    # --- Off-job hours (matched by user id) ---
    off = db.query(OffJobEntry).filter(OffJobEntry.submitted_by_id == current_user.id).all()

    # --- Bucket by week ---
    weeks: dict[date, dict] = defaultdict(
        lambda: {"billable": 0.0, "non_billable": 0.0, "other": 0.0}
    )

    for u, hrs in job_hours.items():
        d = job_date.get(u)
        if d is not None:
            weeks[_week_start(d)]["billable"] += hrs

    for entry in off:
        d = _parse_date(entry.work_date)
        if d is None and entry.created_at is not None:
            d = utc_naive_to_mountain_date(entry.created_at)
        if d is None:
            continue
        ws = _week_start(d)
        ps = (entry.pay_structure or "regular").lower()
        hrs = float(entry.hours or 0)
        if ps == "non_billable":
            weeks[ws]["non_billable"] += hrs
        elif ps == "regular":
            weeks[ws]["billable"] += hrs
        else:
            weeks[ws]["other"] += hrs

    result = []
    tot = {"regular": 0.0, "ot": 0.0, "non_billable": 0.0, "other": 0.0}
    for ws in sorted(weeks.keys(), reverse=True):
        b = weeks[ws]["billable"]
        regular = min(OT_THRESHOLD, b)
        ot = max(0.0, b - OT_THRESHOLD)
        nb = weeks[ws]["non_billable"]
        other = weeks[ws]["other"]
        tot["regular"] += regular
        tot["ot"] += ot
        tot["non_billable"] += nb
        tot["other"] += other
        result.append(
            {
                "week_start": ws.isoformat(),
                "regular_hours": round(regular, 2),
                "ot_hours": round(ot, 2),
                "non_billable_hours": round(nb, 2),
                "other_hours": round(other, 2),
                "total_hours": round(b + nb + other, 2),
            }
        )

    return {
        "weeks": result,
        "summary": {
            "regular_hours": round(tot["regular"], 2),
            "ot_hours": round(tot["ot"], 2),
            "non_billable_hours": round(tot["non_billable"], 2),
            "other_hours": round(tot["other"], 2),
            "total_hours": round(
                tot["regular"] + tot["ot"] + tot["non_billable"] + tot["other"], 2
            ),
        },
    }
