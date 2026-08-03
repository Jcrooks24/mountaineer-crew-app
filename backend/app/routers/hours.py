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

**Bounded to the last two Monday-anchored weeks.** This endpoint is hit by every
crew member on every Profile mount. It originally loaded EVERY job report ever
written, JSON-parsed each one's employee-hours blob to find the caller's name,
and then pulled every event row for every job they had ever touched. That cost
grows forever with the company, on a 512 MB Render worker with a history of OOM
kills (see CLAUDE.md). The window makes the query cost constant instead: it does
not grow as the company ages. Widening it is not free, read the note on
_window_start before you do.
"""
import json
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.core.time_utils import (
    MOUNTAIN_TZ,
    mountain_day_utc_bounds,
    utc_naive_to_mountain_date,
)
from app.db.models.event import Event
from app.db.models.job_report import JobReport
from app.db.models.off_job_entry import OffJobEntry
from app.db.models.office_hours import OfficeHoursEntry
from app.db.models.user import User

router = APIRouter(prefix="/api/hours", tags=["hours"])

OT_THRESHOLD = 40.0

# How many Monday-anchored weeks the card shows: the current week plus the one
# before it. Anchoring on Monday (rather than "14 days back from now") keeps the
# weekly buckets whole, so the first row is never a partial week whose OT total
# looks wrong.
WINDOW_WEEKS = 2

# Hard cap on how far back the crew can expand the "see more" history. Bounds the
# scan so a big `weeks` value can't turn the per-mount query into a full-table
# read on the 512 MB worker.
MAX_WINDOW_WEEKS = 26


def _week_start(d: date) -> date:
    """Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def _window_start(weeks: int = WINDOW_WEEKS) -> date:
    """Monday of the earliest week we report on.

    Every row the endpoint touches is filtered on this, so it is the single knob
    controlling how much of the database this query reads. The default (2 weeks)
    keeps the per-mount Profile query small; the crew can ask for more history
    on demand via the `weeks` param, capped at MAX_WINDOW_WEEKS.
    """
    today_mt = datetime.now(MOUNTAIN_TZ).date()
    return _week_start(today_mt) - timedelta(days=7 * (max(1, weeks) - 1))


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


def _like_escape(s: str) -> str:
    """Escape LIKE wildcards so a name containing % or _ is matched literally."""
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get("/worked-history")
def worked_history(
    weeks: int = Query(default=WINDOW_WEEKS, ge=1, le=MAX_WINDOW_WEEKS),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    my_name = (current_user.name or "").strip().lower()
    my_id = current_user.id
    window_start = _window_start(weeks)
    # Naive-UTC instant at the start of that Mountain day, ready to compare
    # against the naive-UTC timestamp columns.
    window_start_utc, _ = mountain_day_utc_bounds(window_start)

    def _is_me(entry: dict) -> bool:
        """Does this employee-hours row belong to the caller?

        user_id is the real key. Rows written before that field existed have only
        a name, so they still match on the name string, which is why the fallback
        stays: dropping it would silently zero out every crew member's history.
        A row that HAS a user_id is matched on it alone - if it names somebody
        else's id, a matching name is a coincidence, not a claim.
        """
        uid = entry.get("user_id")
        if isinstance(uid, int):
            return uid == my_id
        return (entry.get("name") or "").strip().lower() == my_name

    # --- Job-report hours (matched by roster user_id, or name on legacy rows) ---
    job_hours: dict[str, float] = defaultdict(float)
    report_updated: dict[str, datetime] = {}
    if my_name or my_id:
        # Two filters do the work, and neither is cosmetic:
        #
        # updated_at: a report is written during or after the job it describes, so
        #   its updated_at is always >= the job's own date. A job inside the window
        #   therefore cannot have a report older than the window, which makes this
        #   a safe prefilter (no false negatives). It is COARSE in the other
        #   direction though: a report edited yesterday for a job three months ago
        #   passes it. That is re-checked exactly against the real job date below.
        #
        # ILIKE on the JSON blob: a coarse "might mention me" test, in EITHER of the
        #   two shapes a row can take. Current rows carry the roster id, so we look
        #   for the serialized `"user_id": 42`; legacy rows have only a name, so we
        #   also look for the name. Both are substring tests and both can
        #   false-POSITIVE (`"user_id": 4` is a prefix of `"user_id": 42`; "Jo" sits
        #   inside "Joanna"). That is fine: _is_me() is what actually decides. Their
        #   only job is to stop us dragging every other crew member's reports into
        #   memory.
        #
        #   Both halves are needed. Matching only the name would MISS a row keyed to
        #   this user's id after they were renamed in the roster, which is precisely
        #   the failure the user_id key exists to prevent.
        maybe_mine = [
            JobReport.employee_hours_json.ilike(
                f'%"user_id": {my_id}%', escape="\\"
            ),
            # json.dumps with no separators arg writes `"user_id": 42`, but do not
            # bet the query on one serializer's spacing.
            JobReport.employee_hours_json.ilike(
                f'%"user_id":{my_id}%', escape="\\"
            ),
        ]
        if my_name:
            maybe_mine.append(
                JobReport.employee_hours_json.ilike(
                    f"%{_like_escape(my_name)}%", escape="\\"
                )
            )

        rows = (
            db.query(
                JobReport.job_uuid, JobReport.employee_hours_json, JobReport.updated_at
            )
            .filter(
                JobReport.updated_at >= window_start_utc,
                JobReport.employee_hours_json.isnot(None),
                or_(*maybe_mine),
            )
            .all()
        )
        for job_uuid, eh_json, updated_at in rows:
            report_updated[job_uuid] = updated_at
            if not eh_json:
                continue
            try:
                entries = json.loads(eh_json)
            except Exception:
                continue
            for e in entries or []:
                if isinstance(e, dict) and _is_me(e):
                    job_hours[job_uuid] += float(e.get("hours") or 0)

    # Date each job by its earliest event (Mountain date); fall back to the
    # report's updated_at when a job has no synced events.
    #
    # min() in SQL, grouped: this used to pull EVERY event row for every job the
    # crew member had touched and take the minimum in Python. A busy job has
    # hundreds of events and none of them were needed beyond the first.
    job_date: dict[str, date] = {}
    if job_hours:
        uuids = list(job_hours.keys())
        earliest: dict[str, datetime] = {
            job_uuid: ts
            for job_uuid, ts in db.query(
                Event.job_uuid, func.min(Event.timestamp)
            )
            .filter(Event.job_uuid.in_(uuids))
            .group_by(Event.job_uuid)
            .all()
            if ts is not None
        }
        for u in uuids:
            ts = earliest.get(u) or report_updated.get(u)
            if ts is None:
                continue
            d = utc_naive_to_mountain_date(ts)
            # The exact check the coarse updated_at prefilter could not make: an
            # old job whose report was edited recently is dated by the JOB, not by
            # the edit, so it drops out here.
            if d >= window_start:
                job_date[u] = d

    # --- Off-job hours (matched by user id) ---
    # work_date is an ISO "YYYY-MM-DD" string, so a lexicographic >= is a real
    # date comparison. Entries with no work_date fall back to created_at, and the
    # filter has to allow for both or those rows vanish.
    off = (
        db.query(OffJobEntry)
        .filter(
            OffJobEntry.submitted_by_id == current_user.id,
            or_(
                OffJobEntry.work_date >= window_start.isoformat(),
                and_(
                    OffJobEntry.work_date.is_(None),
                    OffJobEntry.created_at >= window_start_utc,
                ),
            ),
        )
        .all()
    )

    # --- Office hours (office staff log a day's non-job time; matched by user id) ---
    # Paid but not billed to a client and not job hours, so they get their OWN
    # summary line rather than being folded into billable/OT. Bucketed by
    # work_date like off-job entries. Payroll counts the same hours as
    # non-billable pay - this just breaks them out so the person can see them.
    office = (
        db.query(OfficeHoursEntry)
        .filter(
            OfficeHoursEntry.user_id == current_user.id,
            OfficeHoursEntry.work_date >= window_start.isoformat(),
        )
        .all()
    )

    # --- Bucket by week ---
    weeks: dict[date, dict] = defaultdict(
        lambda: {"billable": 0.0, "non_billable": 0.0, "other": 0.0, "office": 0.0}
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
        # A malformed work_date string can slip past the SQL comparison (it is a
        # text column, not a date). Re-check against the real parsed date so a
        # junk value cannot smuggle an out-of-window week into the response.
        if d < window_start:
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

    for entry in office:
        d = _parse_date(entry.work_date)
        if d is None or d < window_start:
            continue
        weeks[_week_start(d)]["office"] += float(entry.hours or 0)

    result = []
    tot = {"regular": 0.0, "ot": 0.0, "non_billable": 0.0, "other": 0.0, "office": 0.0}
    for ws in sorted(weeks.keys(), reverse=True):
        b = weeks[ws]["billable"]
        regular = min(OT_THRESHOLD, b)
        ot = max(0.0, b - OT_THRESHOLD)
        nb = weeks[ws]["non_billable"]
        other = weeks[ws]["other"]
        office_h = weeks[ws]["office"]
        tot["regular"] += regular
        tot["ot"] += ot
        tot["non_billable"] += nb
        tot["other"] += other
        tot["office"] += office_h
        result.append(
            {
                "week_start": ws.isoformat(),
                "regular_hours": round(regular, 2),
                "ot_hours": round(ot, 2),
                "non_billable_hours": round(nb, 2),
                "other_hours": round(other, 2),
                "office_hours": round(office_h, 2),
                "total_hours": round(b + nb + other + office_h, 2),
            }
        )

    return {
        "weeks": result,
        "summary": {
            "regular_hours": round(tot["regular"], 2),
            "ot_hours": round(tot["ot"], 2),
            "non_billable_hours": round(tot["non_billable"], 2),
            "other_hours": round(tot["other"], 2),
            "office_hours": round(tot["office"], 2),
            "total_hours": round(
                tot["regular"] + tot["ot"] + tot["non_billable"]
                + tot["other"] + tot["office"], 2
            ),
        },
    }


@router.get("/daily")
def daily_hours(
    start: str = Query(...),
    end: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-day TOTAL worked hours (job + off-job + office) for the caller across
    [start, end] inclusive. Powers the PODS auto-fill: a driver's on-duty hours
    for the days before an LD trip, summing every hour type per day.

    Same sources as /worked-history so the two agree; kept separate because this
    is on-demand (not per-mount) and buckets by DAY, not week. If you change how
    a source is matched here, change it there too.
    """
    start_d = _parse_date(start)
    end_d = _parse_date(end)
    if not start_d or not end_d or end_d < start_d or (end_d - start_d).days > 62:
        return {"days": []}

    start_utc, _ = mountain_day_utc_bounds(start_d)
    my_name = (current_user.name or "").strip().lower()
    my_id = current_user.id

    def _is_me(entry: dict) -> bool:
        uid = entry.get("user_id")
        if isinstance(uid, int):
            return uid == my_id
        return (entry.get("name") or "").strip().lower() == my_name

    per_day: dict[date, float] = defaultdict(float)

    # Job-report hours, dated by the job's earliest event (see /worked-history for
    # why the ILIKE prefilter + _is_me both exist).
    job_hours: dict[str, float] = defaultdict(float)
    report_updated: dict[str, datetime] = {}
    maybe_mine = [
        JobReport.employee_hours_json.ilike(f'%"user_id": {my_id}%', escape="\\"),
        JobReport.employee_hours_json.ilike(f'%"user_id":{my_id}%', escape="\\"),
    ]
    if my_name:
        maybe_mine.append(JobReport.employee_hours_json.ilike(f"%{_like_escape(my_name)}%", escape="\\"))
    for job_uuid, eh_json, updated_at in (
        db.query(JobReport.job_uuid, JobReport.employee_hours_json, JobReport.updated_at)
        .filter(JobReport.updated_at >= start_utc, JobReport.employee_hours_json.isnot(None), or_(*maybe_mine))
        .all()
    ):
        report_updated[job_uuid] = updated_at
        try:
            entries = json.loads(eh_json or "[]")
        except Exception:
            continue
        for e in entries or []:
            if isinstance(e, dict) and _is_me(e):
                job_hours[job_uuid] += float(e.get("hours") or 0)

    if job_hours:
        uuids = list(job_hours.keys())
        earliest = {
            ju: ts
            for ju, ts in db.query(Event.job_uuid, func.min(Event.timestamp))
            .filter(Event.job_uuid.in_(uuids)).group_by(Event.job_uuid).all()
            if ts is not None
        }
        for u, hrs in job_hours.items():
            ts = earliest.get(u) or report_updated.get(u)
            if ts is None:
                continue
            d = utc_naive_to_mountain_date(ts)
            if start_d <= d <= end_d:
                per_day[d] += hrs

    # Off-job hours (by work_date).
    for entry in (
        db.query(OffJobEntry)
        .filter(
            OffJobEntry.submitted_by_id == my_id,
            or_(
                OffJobEntry.work_date >= start_d.isoformat(),
                and_(OffJobEntry.work_date.is_(None), OffJobEntry.created_at >= start_utc),
            ),
        )
        .all()
    ):
        d = _parse_date(entry.work_date)
        if d is None and entry.created_at is not None:
            d = utc_naive_to_mountain_date(entry.created_at)
        if d is not None and start_d <= d <= end_d:
            per_day[d] += float(entry.hours or 0)

    # Office hours (by work_date).
    for entry in (
        db.query(OfficeHoursEntry)
        .filter(OfficeHoursEntry.user_id == my_id, OfficeHoursEntry.work_date >= start_d.isoformat())
        .all()
    ):
        d = _parse_date(entry.work_date)
        if d is not None and start_d <= d <= end_d:
            per_day[d] += float(entry.hours or 0)

    days = []
    cur = start_d
    while cur <= end_d:
        days.append({"date": cur.isoformat(), "hours": round(per_day.get(cur, 0.0), 2)})
        cur += timedelta(days=1)
    return {"days": days}
