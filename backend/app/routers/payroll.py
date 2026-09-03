"""
Admin payroll tool: one page that turns everything the app already collects into
the numbers an admin types into QuickBooks.

The app has never stored a pay rate and does not start here (ADR 0029). This
endpoint answers "how many hours, in which bucket, for whom" and nothing about
money except the dollar figures crew already entered themselves (approved
expense reimbursements). Rates, gross pay and tax live in QuickBooks.

## Where the numbers come from

  job          per-employee hours inside a job report's employee_hours_json,
               dated by the job's earliest event in Mountain time (falling back
               to the report's updated_at, same rule as routers/hours.py)
  off_job      OffJobEntry, dated by work_date
  office       OfficeHoursEntry, dated by work_date
  per-diem     LdDay rows flagged out_of_town, plus the per-employee
               out_of_town flag on job-report hours, de-duplicated by
               (employee, night) so a driver who is marked in both places is
               owed one per-diem, not two
  reimbursable approved Reimbursement rows paid with a personal card

## Buckets

  billable       worked on a job, billed to a client
  non_billable   paid, not billed (office time, shop work, errands)
  other          an off-job pay structure management approved case by case
  per_diem_nights   a count of nights, not hours

Overtime is computed per Monday-anchored week from the billable total only:
anything over 40 is OT. Non-billable and other do NOT count toward the 40-hour
threshold, matching routers/hours.py so a crew member's Profile card and the
admin payroll page can never disagree.

**OT is computed after corrections are applied.** A correction that moves 6
hours out of billable can drop somebody under 40, and the crew member is owed
the OT the corrected numbers produce, not the OT the raw ones did.

## Corrections

Admin corrections are an override layer, never an edit of crew data (ADR 0029).
See db/models/payroll_correction.py. `_apply_corrections` replaces a source's
contribution rather than adding to it, so re-correcting the same thing is an
edit, not a second adjustment stacking on the first.
"""
from __future__ import annotations

import json
import os
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_db, require_admin
from app.core.mailer import send_email
from app.core.name_sort import surname_key
from app.core.hours_rounding import payroll_rounds, round_billable_quarter
from app.core.payroll_period import set_last_finalized_period
from app.core.time_utils import (
    MOUNTAIN_TZ,
    mountain_day_utc_bounds,
    utc_naive_to_mountain_date,
)
from app.db.models.admin_entry_status import AdminEntryStatus
from app.db.models.event import Event
from app.db.models.job_report import JobReport
from app.db.models.long_distance import LdDay
from app.db.models.off_job_entry import OffJobEntry
from app.db.models.office_hours import OfficeHoursEntry
from app.db.models.payroll_correction import (
    CORRECTION_BUCKETS,
    CORRECTION_SOURCES,
    PayrollCorrection,
)
from app.db.models.reimbursement import Reimbursement
from app.db.models.user import User
from app.schemas.payroll import (
    JobCorrectionUpsert,
    PayrollCorrectionUpsert,
    PayrollFinalizeRequest,
    ReimbursementDecision,
    ReportWaiverRequest,
)

router = APIRouter(prefix="/api/admin/payroll", tags=["payroll"])

OT_THRESHOLD = 40.0

# A pay period longer than this is almost certainly a typo (a swapped year, a
# mis-set start date), and the scan cost is linear in it. Two months leaves room
# for a monthly period plus a correction pass without letting a stray 2020 date
# read the whole database.
MAX_PERIOD_DAYS = 62

# How far past the period end a job report may be edited and still be picked up
# by the "no events" fallback query. Jobs WITH events are found precisely by
# their events, so this bound only affects manual jobs that never synced a
# timeline - and it is only an upper bound on the scan, not on correctness for
# any job the crew actually ran a timeline on. See the note in _job_hours.
NO_EVENT_REPORT_GRACE_DAYS = 14


# ── Period helpers ───────────────────────────────────────────────────────────

def _week_start(d: date) -> date:
    """Monday of the week containing d."""
    return d - timedelta(days=d.weekday())


def _parse_iso(s: str, field: str) -> date:
    try:
        return date.fromisoformat((s or "").strip()[:10])
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field} must be YYYY-MM-DD")


def _parse_period(start: str, end: str) -> Tuple[date, date]:
    s = _parse_iso(start, "start")
    e = _parse_iso(end, "end")
    if e < s:
        raise HTTPException(status_code=400, detail="end must be on or after start")
    if (e - s).days + 1 > MAX_PERIOD_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"pay period cannot exceed {MAX_PERIOD_DAYS} days",
        )
    return s, e


def _parse_date_str(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s.strip()[:10])
    except Exception:
        return None


# ── The flat contribution list ───────────────────────────────────────────────
# Every source is flattened into rows of the same shape before anything is
# summed. Corrections, day buckets, week buckets and totals all read this one
# list, so a new source only has to produce rows and gets the rest for free.

def _row(
    user_id: Optional[int],
    user_name: str,
    d: date,
    bucket: str,
    hours: float,
    source: str,
    source_key: str,
    source_label: str,
    detail: str = "",
) -> Dict[str, Any]:
    return {
        "user_id": user_id,
        "user_name": user_name,
        "date": d,
        "bucket": bucket,
        "hours": float(hours or 0),
        "source": source,
        "source_key": source_key,
        "source_label": source_label,
        "detail": detail,
    }


def _entry_date(raw: Any) -> Optional[date]:
    """An employee-hours entry's own Mountain 'YYYY-MM-DD' date, or None if absent
    or malformed (legacy rows) so the caller can fall back to the job's date."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        return date.fromisoformat(raw.strip()[:10])
    except (ValueError, TypeError):
        return None


def _job_hours(
    db: Session, start: date, end: date, roster: Dict[int, User], name_to_id: Dict[str, int]
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Per-employee hours from job reports, dated by the job's earliest event.

    Two queries find the candidate reports, and neither is optional:

      A) job_uuids with at least one event inside the window. This is the
         precise one and covers every job a crew actually ran a timeline on.
         It bounds the scan by the PERIOD, not by the age of the company.

      B) reports touched in the window (plus a grace period). This exists only
         for jobs that never synced an event - a manual job someone reported on
         without a timeline - which query A cannot see at all.

    Both are then re-dated exactly and filtered against the real window, so a
    job dragged in by the coarse half of either query drops back out here.
    """
    warnings: List[str] = []
    start_utc, _ = mountain_day_utc_bounds(start)
    _, end_utc = mountain_day_utc_bounds(end)

    # (A) Events inside the window. Widened by a day on each side before the
    # exact Mountain-date check below, so a job whose earliest event sits near
    # a UTC/MT boundary is not clipped.
    ev_lo, _ = mountain_day_utc_bounds(start - timedelta(days=1))
    _, ev_hi = mountain_day_utc_bounds(end + timedelta(days=1))
    event_uuids = {
        u for (u,) in db.query(Event.job_uuid)
        .filter(Event.timestamp >= ev_lo, Event.timestamp < ev_hi)
        .distinct()
        .all()
        if u
    }

    # (B) Reports edited in or shortly after the window.
    _, grace_hi = mountain_day_utc_bounds(end + timedelta(days=NO_EVENT_REPORT_GRACE_DAYS))
    touched_uuids = {
        u for (u,) in db.query(JobReport.job_uuid)
        .filter(JobReport.updated_at >= start_utc, JobReport.updated_at < grace_hi)
        .all()
        if u
    }

    candidates = event_uuids | touched_uuids
    if not candidates:
        return [], warnings

    reports = (
        db.query(
            JobReport.job_uuid,
            JobReport.employee_hours_json,
            JobReport.updated_at,
        )
        .filter(
            JobReport.job_uuid.in_(candidates),
            JobReport.employee_hours_json.isnot(None),
        )
        .all()
    )
    if not reports:
        return [], warnings

    uuids = [r[0] for r in reports]

    # Earliest event per job, in SQL. Pulling every event row and taking the min
    # in Python is the exact mistake routers/hours.py was rewritten to stop
    # making, and a busy job has hundreds of events none of which are needed.
    earliest: Dict[str, datetime] = {
        job_uuid: ts
        for job_uuid, ts in db.query(Event.job_uuid, func.min(Event.timestamp))
        .filter(Event.job_uuid.in_(uuids))
        .group_by(Event.job_uuid)
        .all()
        if ts is not None
    }
    names: Dict[str, str] = {
        job_uuid: nm
        for job_uuid, nm in db.query(Event.job_uuid, func.max(Event.job_name))
        .filter(Event.job_uuid.in_(uuids))
        .group_by(Event.job_uuid)
        .all()
        if nm
    }

    rows: List[Dict[str, Any]] = []
    unmatched: set = set()
    for job_uuid, eh_json, updated_at in reports:
        ts = earliest.get(job_uuid) or updated_at
        if ts is None:
            continue
        # The job's earliest-event date is only the FALLBACK now; each entry is
        # dated by its own `date` so a multi-day job's hours land in the right pay
        # period instead of all pinning to day one (finding 4).
        job_date = utc_naive_to_mountain_date(ts)
        try:
            entries = json.loads(eh_json) or []
        except Exception:
            warnings.append(f"Job {job_uuid[:8]}: employee hours could not be read")
            continue
        label = names.get(job_uuid) or job_uuid[:8]
        for e in entries:
            if not isinstance(e, dict):
                continue
            uid = e.get("user_id")
            nm = (e.get("name") or "").strip()
            if not isinstance(uid, int) or uid not in roster:
                # Rows written before employee_hours carried a user_id have only
                # a name. Resolve it against the roster the same way the crew's
                # own history endpoint does; a name that matches nobody is
                # reported rather than silently dropped, because a dropped row is
                # somebody not getting paid.
                uid = name_to_id.get(nm.lower())
            if uid is None:
                if nm:
                    unmatched.add(nm)
                continue
            # Per-entry date (legacy rows with no date fall back to the job date,
            # reproducing the old whole-job behavior). Filter each ENTRY into the
            # window rather than skipping the whole job on its first day.
            entry_date = _entry_date(e.get("date")) or job_date
            if not (start <= entry_date <= end):
                continue
            hours = float(e.get("hours") or 0)
            bucket = "non_billable" if e.get("non_billable") else "billable"
            if hours:
                rows.append(
                    _row(uid, roster[uid].name or nm, entry_date, bucket, hours,
                         "job", job_uuid, label)
                )
            if e.get("out_of_town"):
                rows.append(
                    _row(uid, roster[uid].name or nm, entry_date, "per_diem_nights", 1,
                         "job", job_uuid, label, detail="out of town")
                )

    for nm in sorted(unmatched):
        warnings.append(
            f'"{nm}" appears on a job report but matches nobody on the roster, '
            "so their hours are not counted. Fix the name on the report or add "
            "them to the roster."
        )
    return rows, warnings


def _off_job_hours(
    db: Session, start: date, end: date, roster: Dict[int, User]
) -> List[Dict[str, Any]]:
    entries = (
        db.query(OffJobEntry)
        .filter(
            OffJobEntry.work_date >= start.isoformat(),
            OffJobEntry.work_date <= end.isoformat(),
        )
        .all()
    )
    rows: List[Dict[str, Any]] = []
    for e in entries:
        uid = e.submitted_by_id
        if uid is None or uid not in roster:
            continue
        # work_date is a text column, so the SQL range above is a string compare.
        # A malformed value can slip through it; re-check the parsed date.
        d = _parse_date_str(e.work_date)
        if d is None or not (start <= d <= end):
            continue
        ps = (e.pay_structure or "regular").lower()
        bucket = {"regular": "billable", "non_billable": "non_billable"}.get(ps, "other")
        detail = (e.pay_other_note or "").strip() if bucket == "other" else ""
        rows.append(
            _row(uid, roster[uid].name or e.submitted_by_name or "", d, bucket,
                 float(e.hours or 0), "off_job", e.entry_uuid,
                 (e.notes or "Off-job")[:80], detail=detail)
        )
    return rows


def _office_hours(
    db: Session, start: date, end: date, roster: Dict[int, User]
) -> List[Dict[str, Any]]:
    """Office time is paid but not billed to a client, so it lands in
    non_billable - which is where it ends up on the payroll sheet today. An
    admin who disagrees on a given period can move it with a correction."""
    entries = (
        db.query(OfficeHoursEntry)
        .filter(
            OfficeHoursEntry.work_date >= start.isoformat(),
            OfficeHoursEntry.work_date <= end.isoformat(),
        )
        .all()
    )
    rows: List[Dict[str, Any]] = []
    for e in entries:
        uid = e.user_id
        if uid is None or uid not in roster:
            continue
        d = _parse_date_str(e.work_date)
        if d is None or not (start <= d <= end):
            continue
        rows.append(
            _row(uid, roster[uid].name or e.user_name, d, "non_billable",
                 float(e.hours or 0), "office", e.entry_uuid, "Office hours")
        )
    return rows


def _per_diem_nights(
    db: Session, start: date, end: date, roster: Dict[int, User],
    existing: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Nights owed a per-diem, from the LD day log.

    De-duplicated against the per-employee out_of_town flag already collected
    from job reports: a driver marked out of town in both places spent one night
    away and is owed one per-diem. Counting both was the bug this guards.
    """
    already = {
        (r["user_id"], r["date"])
        for r in existing
        if r["bucket"] == "per_diem_nights"
    }
    days = (
        db.query(LdDay)
        .filter(
            LdDay.date >= start.isoformat(),
            LdDay.date <= end.isoformat(),
            LdDay.out_of_town.is_(True),
        )
        .all()
    )
    rows: List[Dict[str, Any]] = []
    for ld in days:
        uid = ld.driver_id
        if uid is None or uid not in roster:
            continue
        d = _parse_date_str(ld.date)
        if d is None or not (start <= d <= end) or (uid, d) in already:
            continue
        already.add((uid, d))
        rows.append(
            _row(uid, roster[uid].name or ld.driver_name, d, "per_diem_nights", 1,
                 "job", ld.job_uuid or ld.day_id, ld.job_name or "Long distance",
                 detail="out of town")
        )
    return rows


def _reimbursements(
    db: Session, start: date, end: date, roster: Dict[int, User]
) -> Dict[int, Dict[str, Any]]:
    """Approved, personally-paid reimbursements owed in this period.

    Company-card expenses are excluded: they are an expense log, not money owed
    back to anybody. That exclusion is the `payment_method == "personal"` test
    below, and it was re-verified 2026-09-03 against a report asking whether
    company-card purchases were leaking into payroll. They are not.

    Mileage is counted by TYPE, not by payment method: a mileage claim is about
    whose vehicle was used, not whose card. It is converted to dollars using the
    configured rate (ADR 0033); an older version of this note said mileage
    carried no rate and left the figure to the admin, which stopped being true
    when the rates became configurable.
    """
    # PAY UNLESS DECLINED. Everything except what an admin explicitly rejected
    # counts toward the totals.
    #
    # This once required status == "approved". Reimbursement.status defaults to
    # "submitted" and there was no approval control anywhere in the app, so that
    # filter could never match: payroll reported $0 and 0 miles for every
    # employee, permanently, while crew filed real expenses. A zero meaning
    # "nothing passed an unreachable gate" looks exactly like a zero meaning
    # "nothing was submitted", which is why it went unnoticed for so long.
    #
    # There IS an approval control now, and the direction is still pay-unless-
    # declined rather than pay-only-if-approved. Deliberate: a forgotten approval
    # must never silently underpay somebody. `unreviewed` below surfaces anything
    # still awaiting a decision so nothing slips by unseen, and finalize warns on
    # it - the safe default plus a visible nag, rather than a quiet zero.
    #
    # Rejected rows are FETCHED but not summed. The admin has to be able to see a
    # decline to undo it; filtering them out of the query made a mis-click
    # unrecoverable from the payroll screen.
    rows = db.query(Reimbursement).all()
    out: Dict[int, Dict[str, Any]] = defaultdict(
        lambda: {"amount": 0.0, "miles": 0, "items": [], "unreviewed": 0}
    )
    for r in rows:
        uid = r.user_id
        if uid is None or uid not in roster:
            continue
        d = _parse_date_str(r.expense_date) or (
            utc_naive_to_mountain_date(r.created_at) if r.created_at else None
        )
        if d is None or not (start <= d <= end):
            continue
        status = (r.status or "submitted").strip() or "submitted"
        counts = status != "rejected"
        if status == "submitted":
            out[uid]["unreviewed"] += 1
        base = {
            "uuid": r.reimbursement_uuid,
            "date": d.isoformat(),
            "status": status,
            "notes": r.approval_notes or "",
            "approver": r.approver_name or "",
        }
        if r.type == "mileage":
            if r.odometer_start is not None and r.odometer_end is not None:
                miles = max(0, int(r.odometer_end) - int(r.odometer_start))
                if counts:
                    out[uid]["miles"] += miles
                out[uid]["items"].append(
                    {**base, "kind": "mileage",
                     "label": f"{miles} mi", "amount": None, "miles": miles}
                )
        elif r.payment_method == "personal" and r.amount is not None:
            amt = float(r.amount)
            if counts:
                out[uid]["amount"] += amt
            out[uid]["items"].append(
                {**base, "kind": "expense",
                 "label": (r.vendor or r.category or "Expense"),
                 "amount": round(amt, 2), "miles": None}
            )
    return out


# ── Corrections ──────────────────────────────────────────────────────────────

def _correction_target(r: Dict[str, Any]) -> Tuple[Any, ...]:
    return (r["user_id"], r["source"], r["source_key"], r["bucket"])


def _round_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Quarter-round every contribution, BEFORE anything is summed.

    Payroll used to sum raw hours and round the total to two decimal places,
    while the Sheet quarter-rounded each entry. Two numbers for the same work,
    and the one people were paid from was the unrounded one.

    Rounding here - per contribution, after corrections, before every sum - is
    what "round at the job level, then sum the rounded hours" means. It is not
    the same as rounding the total: three 2.05h entries are 2.25 x 3 = 6.75
    rounded first, and 6.15 -> 6.25 rounded last. The first is what the job
    report and the Sheet already show a crew member for those same three jobs.

    `per_diem_nights` rows are skipped. Their "hours" is a COUNT of nights, not
    a duration, and rounding a count is meaningless even where it is harmless.
    """
    out: List[Dict[str, Any]] = []
    for r in rows:
        if r["bucket"] == "per_diem_nights":
            out.append(r)
            continue
        out.append({**r, "hours": round_billable_quarter(float(r["hours"] or 0))})
    return out


def _dedupe_corrections(
    corrections: List[PayrollCorrection],
) -> List[PayrollCorrection]:
    """Collapse corrections that share a target, preferring the job-scoped one.

    A job correction and a legacy period-scoped correction can point at the same
    (user, source="job", source_key=job_uuid, bucket) - the latter left over
    from before ADR 0032. They would both match the same rows in
    _apply_corrections, and only one can win. The job-scoped row is the current
    one, so it takes precedence; the job correction endpoint also migrates a
    legacy row in place on the first edit, so this only bridges the window
    before that happens.
    """
    by_target: Dict[Tuple[Any, ...], PayrollCorrection] = {}
    for c in corrections:
        key = (c.user_id, c.source, c.source_key, c.bucket)
        existing = by_target.get(key)
        if existing is None or (existing.job_uuid is None and c.job_uuid is not None):
            by_target[key] = c
    return list(by_target.values())


def _apply_corrections(
    rows: List[Dict[str, Any]],
    corrections: List[PayrollCorrection],
    roster: Dict[int, User],
) -> Tuple[List[Dict[str, Any]], Dict[Tuple[Any, ...], PayrollCorrection]]:
    """Overlay corrections on the raw contribution rows.

    A correction REPLACES its target's contribution rather than adjusting it, so
    correcting the same thing twice is an edit and not two stacked adjustments.
    When a correction has no matching row (its job was deleted, or it is a manual
    line that never had one), it becomes a row of its own - an admin's decision
    about a period must not evaporate because the underlying record moved.
    """
    by_target: Dict[Tuple[Any, ...], PayrollCorrection] = {
        (c.user_id, c.source, c.source_key, c.bucket): c for c in corrections
    }
    matched: set = set()
    out: List[Dict[str, Any]] = []

    # Group rows by target so a source contributing several rows to one bucket
    # (two hour entries for the same person on one job) is corrected as the one
    # unit an admin sees, not per hidden sub-row.
    grouped: Dict[Tuple[Any, ...], List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[_correction_target(r)].append(r)

    for target, group in grouped.items():
        c = by_target.get(target)
        if c is None:
            out.extend(group)
            continue
        matched.add(target)
        reported = sum(r["hours"] for r in group)
        # Keep the first row's date/label so the corrected hours stay in the
        # right day column and the right OT week.
        base = dict(group[0])
        base["hours"] = float(c.corrected_hours)
        base["reported_hours"] = reported
        base["correction_id"] = c.id
        base["correction_reason"] = c.reason
        out.append(base)

    for target, c in by_target.items():
        if target in matched:
            continue
        d = _parse_date_str(c.work_date)
        if d is None or c.user_id not in roster:
            continue
        r = _row(
            c.user_id, c.user_name, d, c.bucket, float(c.corrected_hours),
            c.source, c.source_key, c.source_label or "Added by admin",
        )
        r["reported_hours"] = float(c.original_hours)
        r["correction_id"] = c.id
        r["correction_reason"] = c.reason
        out.append(r)

    return out, by_target


# ── Summary assembly ─────────────────────────────────────────────────────────

def _payroll_rates(db: Session) -> Dict[str, float]:
    """The configured mileage ($/mi) and per-diem ($/night) rates, or 0 when
    unset (in which case the page shows units without a dollar figure)."""
    from app.core.payroll_rates import PAYROLL_RATES_KEY, normalize_rates
    from app.db.models.system_config import SystemConfig
    row = db.query(SystemConfig).filter(SystemConfig.key == PAYROLL_RATES_KEY).first()
    raw = None
    if row and row.value:
        try:
            raw = json.loads(row.value)
        except (ValueError, TypeError):
            raw = None
    return normalize_rates(raw)


def _employee_summary(
    user: User, rows: List[Dict[str, Any]], start: date, end: date,
    reimb: Dict[str, Any], rates: Dict[str, float],
) -> Dict[str, Any]:
    days: Dict[date, Dict[str, float]] = defaultdict(
        lambda: {"billable": 0.0, "non_billable": 0.0, "other": 0.0}
    )
    weeks: Dict[date, float] = defaultdict(float)
    per_diem = 0.0

    for r in rows:
        b = r["bucket"]
        if b == "per_diem_nights":
            per_diem += r["hours"]
            continue
        days[r["date"]][b] += r["hours"]
        if b == "billable":
            weeks[_week_start(r["date"])] += r["hours"]

    # OT per Monday-anchored week, on corrected billable hours.
    week_rows = []
    regular = ot = 0.0
    for ws in sorted(weeks.keys()):
        b = weeks[ws]
        wk_reg = min(OT_THRESHOLD, b)
        wk_ot = max(0.0, b - OT_THRESHOLD)
        regular += wk_reg
        ot += wk_ot
        week_rows.append({
            "week_start": ws.isoformat(),
            "billable_hours": round(b, 2),
            "regular_hours": round(wk_reg, 2),
            "ot_hours": round(wk_ot, 2),
            # A week only partly inside the period cannot have its OT judged
            # from this period alone; the UI flags it rather than quietly
            # reporting a number that may be wrong in either direction.
            "partial": ws < start or (ws + timedelta(days=6)) > end,
        })

    non_billable = sum(v["non_billable"] for v in days.values())
    other = sum(v["other"] for v in days.values())

    # Standardized reimbursement rates turn the crew-logged counts into dollars
    # (ADR 0033). A rate of 0 (unset) leaves the amount at 0, and the page shows
    # the miles / nights without a dollar figure.
    nights = int(per_diem)
    miles = int(reimb.get("miles", 0))
    per_diem_amount = round(nights * rates.get("per_diem_rate", 0.0), 2)
    mileage_amount = round(miles * rates.get("mileage_rate", 0.0), 2)

    return {
        "user_id": user.id,
        "name": user.name or user.email,
        "email": user.email,
        "totals": {
            "regular_hours": round(regular, 2),
            "ot_hours": round(ot, 2),
            "non_billable_hours": round(non_billable, 2),
            "other_hours": round(other, 2),
            "total_hours": round(regular + ot + non_billable + other, 2),
            "per_diem_nights": nights,
            "per_diem_amount": per_diem_amount,
            "reimbursement_amount": round(reimb.get("amount", 0.0), 2),
            "mileage_miles": miles,
            "mileage_amount": mileage_amount,
        },
        "weeks": week_rows,
        "days": [
            {
                "date": d.isoformat(),
                "billable_hours": round(v["billable"], 2),
                "non_billable_hours": round(v["non_billable"], 2),
                "other_hours": round(v["other"], 2),
            }
            for d, v in sorted(days.items())
        ],
        "lines": sorted(
            [
                {
                    "date": r["date"].isoformat(),
                    "bucket": r["bucket"],
                    "source": r["source"],
                    "source_key": r["source_key"],
                    "source_label": r["source_label"],
                    "detail": r.get("detail", ""),
                    "hours": round(r["hours"], 2),
                    "reported_hours": (
                        round(r["reported_hours"], 2)
                        if "reported_hours" in r else None
                    ),
                    "correction_id": r.get("correction_id"),
                    "correction_reason": r.get("correction_reason"),
                }
                for r in rows
            ],
            key=lambda x: (x["date"], x["source"], x["source_label"]),
        ),
        "reimbursement_items": reimb.get("items", []),
        # How many of this person's claims nobody has approved or declined yet.
        # They ARE being paid (pay-unless-declined), so this is a nag, not a
        # blocker - it exists so "nobody looked" is visible instead of silent.
        "reimbursements_unreviewed": reimb.get("unreviewed", 0),
        "correction_count": sum(1 for r in rows if r.get("correction_id")),
    }


def _roster(db: Session) -> Tuple[Dict[int, User], Dict[str, int]]:
    """The roster keyed by id, plus a lower-cased-name -> id lookup.

    Inactive users are included: somebody who left mid-period still gets that
    period's paycheck, and their name still has to resolve on an old report.
    """
    roster = {u.id: u for u in db.query(User).filter(User.is_active.is_(True)).all()}
    for u in db.query(User).filter(User.is_active.is_(False)).all():
        roster.setdefault(u.id, u)
    name_to_id = {
        (u.name or "").strip().lower(): u.id
        for u in roster.values()
        if (u.name or "").strip()
    }
    return roster, name_to_id


def _report_less_jobs(db: Session, start: date, end: date) -> List[Dict[str, str]]:
    """Jobs that had events in this period but NO job report at all. They pay
    nobody through _job_hours (which requires employee_hours_json), so the review
    gate would otherwise never see them - the unpaid-drive-leg case. Dated by the
    earliest event's Mountain date, the same rule _job_hours uses."""
    ev_lo, _ = mountain_day_utc_bounds(start - timedelta(days=1))
    _, ev_hi = mountain_day_utc_bounds(end + timedelta(days=1))
    event_uuids = {
        u for (u,) in db.query(Event.job_uuid)
        .filter(Event.timestamp >= ev_lo, Event.timestamp < ev_hi)
        .distinct().all() if u
    }
    if not event_uuids:
        return []
    have_report = {
        u for (u,) in db.query(JobReport.job_uuid)
        .filter(JobReport.job_uuid.in_(list(event_uuids))).all() if u
    }
    missing = event_uuids - have_report
    # Jobs an admin has explicitly waived are not pending anything. Applied here
    # rather than at the gate so the waived job disappears from every count that
    # reads this - jobs_total, the pending list and the finalize block - instead
    # of being subtracted in one place and forgotten in another.
    waived = {
        u for (u,) in db.query(AdminEntryStatus.job_uuid)
        .filter(AdminEntryStatus.job_uuid.in_(list(missing)),
                AdminEntryStatus.report_waived.is_(True)).all() if u
    }
    missing = missing - waived
    if not missing:
        return []
    earliest = {
        u: ts for u, ts in db.query(Event.job_uuid, func.min(Event.timestamp))
        .filter(Event.job_uuid.in_(list(missing))).group_by(Event.job_uuid).all()
        if ts is not None
    }
    names = {
        u: nm for u, nm in db.query(Event.job_uuid, func.max(Event.job_name))
        .filter(Event.job_uuid.in_(list(missing))).group_by(Event.job_uuid).all()
        if nm
    }
    out: List[Dict[str, str]] = []
    for u in missing:
        ts = earliest.get(u)
        if ts is None:
            continue
        if start <= utc_naive_to_mountain_date(ts) <= end:
            out.append({"job_uuid": u, "job_name": names.get(u) or u[:8]})
    return sorted(out, key=lambda j: (j["job_name"] or "").lower())


def _build_summary(db: Session, start: date, end: date) -> Dict[str, Any]:
    roster, name_to_id = _roster(db)

    rows, warnings = _job_hours(db, start, end, roster, name_to_id)
    rows += _off_job_hours(db, start, end, roster)
    rows += _office_hours(db, start, end, roster)
    rows += _per_diem_nights(db, start, end, roster, rows)

    # Corrections come from two places now (ADR 0032):
    #   - job-scoped, loaded by the correction's own work_date falling in this
    #     period. Loading by the job's *produced* rows would silently drop a
    #     correction for a job that produced none (e.g. adding hours the crew
    #     never logged, or a report later cleared) - and the "no matching row ->
    #     its own row" fallback in _apply_corrections would then never fire,
    #     evaporating an admin's decision (the exact thing ADR 0029/0032 forbid).
    #   - period-scoped legacy / non-job rows (off-job, office, manual), keyed by
    #     the period as before.
    job_corrections = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.job_uuid.isnot(None),
            PayrollCorrection.work_date >= start.isoformat(),
            PayrollCorrection.work_date <= end.isoformat(),
        )
        .all()
    )
    period_corrections = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.job_uuid.is_(None),
            PayrollCorrection.period_start == start.isoformat(),
            PayrollCorrection.period_end == end.isoformat(),
        )
        .all()
    )
    corrections = _dedupe_corrections(job_corrections + period_corrections)
    rows, _ = _apply_corrections(rows, corrections, roster)
    # AFTER corrections, so an admin's corrected figure follows the same rule as
    # everything else, and BEFORE any summing. Not retroactive: periods that
    # start before the cutover keep the behaviour they were reconciled under.
    if payroll_rounds(start):
        rows = _round_rows(rows)
    reimb = _reimbursements(db, start, end, roster)
    rates = _payroll_rates(db)

    by_user: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_user[r["user_id"]].append(r)

    employees = [
        _employee_summary(roster[uid], urows, start, end, reimb.get(uid, {}), rates)
        for uid, urows in by_user.items()
        if uid in roster
    ]
    # Anybody with reimbursements but no hours still needs a row: they are owed
    # money and would otherwise be invisible on the page.
    for uid, r in reimb.items():
        if uid not in by_user and uid in roster:
            employees.append(_employee_summary(roster[uid], [], start, end, r, rates))

    # By LAST name. Sorting on the full string put everyone in first-name order,
    # which is not how anyone looks a person up on a payroll run. Mirrors the
    # admin roster, which uses the same rule in frontend/src/lib/nameSort.ts.
    employees.sort(key=lambda e: surname_key(e.get("name"), e.get("email")))

    # Review gate (ADR 0032): the jobs whose hours feed this period, and which of
    # them the admin has reviewed + initialed on the Job Summary. A job is
    # "reviewed" iff an AdminEntryStatus row exists (its write path forces all
    # three attestations true). Finalize is blocked until none are pending.
    period_jobs: Dict[str, str] = {}   # job_uuid -> job name (source_label)
    for r in rows:
        if r.get("source") == "job" and r.get("source_key"):
            period_jobs.setdefault(r["source_key"], r.get("source_label") or "")
    reviewed: set = set()
    if period_jobs:
        # A WAIVER ROW IS NOT A REVIEW.
        #
        # This set used to be "has an AdminEntryStatus row at all". The report
        # waiver creates such a row for a job that had none (entered_by
        # "(waived)", attestation left unset), so waiving a report-less job would
        # ALSO have exempted it from the initialing gate the moment somebody
        # filed a report for it later and it entered period_jobs. The gate exists
        # to stop payroll running over unreviewed work; a waiver says only "no
        # report is coming", never "I checked this".
        #
        # Excluding exactly `report_waived AND validated IS NULL` - a row created
        # by the waiver and never initialed since. Legacy rows (both null, from
        # before ADR 0032's attestation existed) still count as reviewed, so this
        # does not retroactively reopen old periods.
        reviewed = {
            u for (u,) in db.query(AdminEntryStatus.job_uuid)
            .filter(
                AdminEntryStatus.job_uuid.in_(list(period_jobs)),
                ~(
                    (AdminEntryStatus.report_waived.is_(True))
                    & (AdminEntryStatus.validated.is_(None))
                ),
            ).all()
        }
    period_pending = [
        {"job_uuid": u, "job_name": n, "reason": "not initialed"}
        for u, n in sorted(period_jobs.items(), key=lambda kv: (kv[1] or "").lower())
        if u not in reviewed
    ]
    # Jobs that worked this period but never got a report at all (finding 5): they
    # pay nobody, so they never reach period_jobs and would slip past the gate.
    report_less = [
        {**j, "reason": "no report filed"}
        for j in _report_less_jobs(db, start, end)
        if j["job_uuid"] not in period_jobs  # a job with an unmatched correction can appear in both
    ]
    jobs_pending_review = period_pending + report_less

    if _week_start(start) != start:
        warnings.append(
            "The period does not start on a Monday, so the first week is only "
            "partly inside it. Overtime for that week cannot be judged from this "
            "period alone - check it against the previous one."
        )
    if (end - _week_start(end)).days != 6:
        warnings.append(
            "The period does not end on a Sunday, so the last week is only "
            "partly inside it. Overtime for that week may change once the rest "
            "of the week is worked."
        )

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "rates": rates,
        "employees": employees,
        # Only period-scoped (non-job) corrections are mailed from payroll
        # finalize; job corrections are mailed when their job is initialed. The
        # pending count drives the finalize button, so it counts only what
        # finalize would actually send.
        "pending_correction_count": sum(
            1 for c in corrections if c.job_uuid is None and c.notified_at is None
        ),
        "correction_count": len(corrections),
        # Review gate: jobs feeding this period (+ report-less jobs) and how many
        # still need attention before finalize.
        "jobs_total": len(period_jobs) + len(report_less),
        "jobs_reviewed": len(period_jobs) - len(period_pending),
        "jobs_pending_review": jobs_pending_review,
        "warnings": warnings,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary")
def payroll_summary(
    start: str = Query(..., description="Period start, YYYY-MM-DD (inclusive)"),
    end: str = Query(..., description="Period end, YYYY-MM-DD (inclusive)"),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    s, e = _parse_period(start, end)
    return _build_summary(db, s, e)


@router.get("/corrections")
def list_corrections(
    start: str = Query(...),
    end: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    s, e = _parse_period(start, end)
    rows = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.period_start == s.isoformat(),
            PayrollCorrection.period_end == e.isoformat(),
        )
        .order_by(PayrollCorrection.user_name, PayrollCorrection.work_date)
        .all()
    )
    return {"corrections": [_correction_json(c) for c in rows]}


def _correction_json(c: PayrollCorrection) -> Dict[str, Any]:
    return {
        "id": c.id,
        "user_id": c.user_id,
        "user_name": c.user_name,
        "source": c.source,
        "source_key": c.source_key,
        "source_label": c.source_label,
        "work_date": c.work_date,
        "bucket": c.bucket,
        "original_hours": c.original_hours,
        "corrected_hours": c.corrected_hours,
        "reason": c.reason,
        "created_by_name": c.created_by_name,
        "notified_at": c.notified_at.isoformat() if c.notified_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


@router.put("/corrections")
def upsert_correction(
    body: PayrollCorrectionUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    s, e = _parse_period(body.period_start, body.period_end)
    wd = _parse_iso(body.work_date, "work_date")
    if not (s <= wd <= e):
        raise HTTPException(
            status_code=400, detail="work_date must fall inside the pay period"
        )
    if body.source not in CORRECTION_SOURCES:
        raise HTTPException(status_code=400, detail="unknown source")
    # Job hours are corrected at the Job Summary now (ADR 0032), so they carry a
    # job_uuid and get their own audit + per-job crew email. Editing them from
    # the period tool would create a period-scoped duplicate with no job to
    # notify against, so it is refused here with a pointer to the right place.
    if body.source == "job":
        raise HTTPException(
            status_code=400,
            detail=(
                "Job hours are corrected on the Job Summary for that job, not "
                "here. Open the job in Job Summary to correct or explain its "
                "hours."
            ),
        )
    if body.bucket not in CORRECTION_BUCKETS:
        raise HTTPException(status_code=400, detail="unknown bucket")

    target = db.query(User).filter(User.id == body.user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="employee not found")

    # A manual line has no underlying record, so it gets its own key. Sharing a
    # key across manual lines would collapse them under the unique constraint.
    source_key = (body.source_key or "").strip()
    if body.source == "manual" and not source_key:
        source_key = f"manual:{uuid.uuid4()}"

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    existing = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.period_start == s.isoformat(),
            PayrollCorrection.period_end == e.isoformat(),
            PayrollCorrection.user_id == body.user_id,
            PayrollCorrection.source == body.source,
            PayrollCorrection.source_key == source_key,
            PayrollCorrection.bucket == body.bucket,
        )
        .first()
    )

    if existing:
        # Editing a correction that already went out re-arms the notification:
        # the crew member was told the old number and is owed the new one.
        changed = (
            existing.corrected_hours != body.corrected_hours
            or (existing.reason or "") != body.reason
        )
        existing.corrected_hours = body.corrected_hours
        existing.original_hours = body.original_hours
        existing.reason = body.reason
        existing.work_date = wd.isoformat()
        existing.source_label = body.source_label
        existing.created_by_id = admin.id
        existing.created_by_name = admin.name or admin.email
        existing.updated_at = now
        if changed:
            existing.notified_at = None
        db.commit()
        db.refresh(existing)
        return _correction_json(existing)

    c = PayrollCorrection(
        period_start=s.isoformat(),
        period_end=e.isoformat(),
        user_id=body.user_id,
        user_name=target.name or target.email,
        source=body.source,
        source_key=source_key,
        source_label=body.source_label,
        work_date=wd.isoformat(),
        bucket=body.bucket,
        original_hours=body.original_hours,
        corrected_hours=body.corrected_hours,
        reason=body.reason,
        created_by_id=admin.id,
        created_by_name=admin.name or admin.email,
        created_at=now,
        updated_at=now,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _correction_json(c)


@router.delete("/corrections/{correction_id}", status_code=204)
def delete_correction(
    correction_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    c = db.query(PayrollCorrection).filter(PayrollCorrection.id == correction_id).first()
    if c is None:
        raise HTTPException(status_code=404, detail="correction not found")
    db.delete(c)
    db.commit()
    return None


# ── Job-scoped corrections (made from the Job Summary) ───────────────────────
# ADR 0032: job hours are corrected once, at the job, and flow into whichever
# pay period contains the job's date. source stays "job" and source_key stays
# the job_uuid so the summary's target matching is untouched; job_uuid is the
# scope marker and the notify key.

def _job_label(db: Session, job_uuid: str) -> str:
    nm = (
        db.query(func.max(Event.job_name))
        .filter(Event.job_uuid == job_uuid)
        .scalar()
    )
    return (nm or "").strip() or job_uuid[:8]


def _job_work_date(db: Session, job_uuid: str) -> date:
    """The job's date, by the same rule as _job_hours: earliest event in
    Mountain time, falling back to the report's updated_at, then today. Lands a
    job correction in the right by-day column and the right OT week."""
    ts = (
        db.query(func.min(Event.timestamp))
        .filter(Event.job_uuid == job_uuid)
        .scalar()
    )
    if ts is None:
        rep = (
            db.query(JobReport.updated_at)
            .filter(JobReport.job_uuid == job_uuid)
            .first()
        )
        ts = rep[0] if rep else None
    if ts is None:
        return datetime.now(MOUNTAIN_TZ).date()
    return utc_naive_to_mountain_date(ts)


def _job_reported(
    db: Session, job_uuid: str, roster: Dict[int, User], name_to_id: Dict[str, int]
) -> Dict[Tuple[int, str], Dict[str, Any]]:
    """What the crew reported on this job, grouped by (user_id, bucket).

    The exact numbers _job_hours produces, so the "before" on a correction (and
    thus the email) matches what the payroll page shows. Keyed by bucket because
    a correction targets a bucket: billable, non_billable, or per_diem_nights.
    """
    rep = (
        db.query(JobReport.employee_hours_json)
        .filter(JobReport.job_uuid == job_uuid)
        .first()
    )
    out: Dict[Tuple[int, str], Dict[str, Any]] = {}
    if not rep or not rep[0]:
        return out
    try:
        entries = json.loads(rep[0]) or []
    except Exception:
        return out
    for e in entries:
        if not isinstance(e, dict):
            continue
        uid = e.get("user_id")
        nm = (e.get("name") or "").strip()
        if not isinstance(uid, int) or uid not in roster:
            uid = name_to_id.get(nm.lower())
        if uid is None:
            continue
        name = roster[uid].name or nm
        hours = float(e.get("hours") or 0)
        bucket = "non_billable" if e.get("non_billable") else "billable"
        if hours:
            slot = out.setdefault((uid, bucket), {"hours": 0.0, "user_name": name})
            slot["hours"] += hours
        if e.get("out_of_town"):
            slot = out.setdefault((uid, "per_diem_nights"), {"hours": 0.0, "user_name": name})
            slot["hours"] += 1
    return out


def _find_job_correction(
    db: Session, job_uuid: str, user_id: int, bucket: str
) -> Optional[PayrollCorrection]:
    """The existing correction for this (job, employee, bucket), if any.

    Prefers a job-scoped row; falls back to a legacy period-scoped job
    correction (source="job", source_key=job_uuid) so the first edit from the
    Job Summary migrates it in place rather than leaving a period-scoped
    duplicate the read path then has to dedupe forever.
    """
    matches = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.user_id == user_id,
            PayrollCorrection.source == "job",
            PayrollCorrection.source_key == job_uuid,
            PayrollCorrection.bucket == bucket,
        )
        .all()
    )
    for m in matches:
        if m.job_uuid == job_uuid:
            return m
    return matches[0] if matches else None


def _job_correction_json(c: PayrollCorrection) -> Dict[str, Any]:
    return {
        "id": c.id,
        "user_id": c.user_id,
        "user_name": c.user_name,
        "bucket": c.bucket,
        "original_hours": c.original_hours,
        "corrected_hours": c.corrected_hours,
        "reason": c.reason,
        "created_by_name": c.created_by_name,
        "notified_at": c.notified_at.isoformat() if c.notified_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/job/{job_uuid}/corrections")
def list_job_corrections(
    job_uuid: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Everything the Job Summary needs to show and edit this job's corrections:
    what the crew reported per (employee, bucket), and any corrections already
    on record."""
    roster, name_to_id = _roster(db)
    reported = _job_reported(db, job_uuid, roster, name_to_id)
    corrections = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.source == "job",
            PayrollCorrection.source_key == job_uuid,
        )
        .all()
    )
    corrections = _dedupe_corrections(corrections)
    pending = sum(1 for c in corrections if c.notified_at is None)
    return {
        "job_uuid": job_uuid,
        "job_name": _job_label(db, job_uuid),
        "work_date": _job_work_date(db, job_uuid).isoformat(),
        "reported": [
            {
                "user_id": uid,
                "user_name": v["user_name"],
                "bucket": bucket,
                "hours": round(v["hours"], 2),
            }
            for (uid, bucket), v in sorted(
                reported.items(), key=lambda kv: (kv[1]["user_name"].lower(), kv[0][1])
            )
        ],
        "corrections": [_job_correction_json(c) for c in corrections],
        "pending_notify_count": pending,
    }


@router.put("/job/{job_uuid}/corrections")
def upsert_job_correction(
    job_uuid: str,
    body: JobCorrectionUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if body.bucket not in CORRECTION_BUCKETS:
        raise HTTPException(status_code=400, detail="unknown bucket")

    roster, name_to_id = _roster(db)
    target = roster.get(body.user_id) or db.query(User).filter(User.id == body.user_id).first()
    if target is None:
        raise HTTPException(status_code=404, detail="employee not found")

    # Both derived from the job's record, never trusted from the client: the
    # "before" is what the crew reported (so the email is honest), and the date
    # is the job's date (so the correction lands in the right period and week).
    reported = _job_reported(db, job_uuid, roster, name_to_id)
    original = float(reported.get((body.user_id, body.bucket), {}).get("hours", 0.0))
    work_date = _job_work_date(db, job_uuid).isoformat()
    label = _job_label(db, job_uuid)
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    existing = _find_job_correction(db, job_uuid, body.user_id, body.bucket)
    if existing is not None:
        # Editing a correction that already went out re-arms the notification:
        # the crew member was told the old number and is owed the new one.
        changed = (
            existing.corrected_hours != body.corrected_hours
            or (existing.reason or "") != body.reason
        )
        existing.job_uuid = job_uuid          # migrate a legacy row in place
        existing.period_start = None
        existing.period_end = None
        existing.corrected_hours = body.corrected_hours
        existing.original_hours = original
        existing.reason = body.reason
        existing.work_date = work_date
        existing.source_label = label
        existing.user_name = target.name or target.email
        existing.created_by_id = admin.id
        existing.created_by_name = admin.name or admin.email
        existing.updated_at = now
        if changed:
            existing.notified_at = None
        db.commit()
        db.refresh(existing)
        return _job_correction_json(existing)

    c = PayrollCorrection(
        job_uuid=job_uuid,
        period_start=None,
        period_end=None,
        user_id=body.user_id,
        user_name=target.name or target.email,
        source="job",
        source_key=job_uuid,
        source_label=label,
        work_date=work_date,
        bucket=body.bucket,
        original_hours=original,
        corrected_hours=body.corrected_hours,
        reason=body.reason,
        created_by_id=admin.id,
        created_by_name=admin.name or admin.email,
        created_at=now,
        updated_at=now,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _job_correction_json(c)


@router.delete("/job/{job_uuid}/corrections/{correction_id}", status_code=204)
def delete_job_correction(
    job_uuid: str,
    correction_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    c = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.id == correction_id,
            PayrollCorrection.source_key == job_uuid,
        )
        .first()
    )
    if c is None:
        raise HTTPException(status_code=404, detail="correction not found")
    db.delete(c)
    db.commit()
    return None


def _job_correction_email(
    db: Session, employee_name: str, job_name: str, work_date: str,
    cs: List[PayrollCorrection],
) -> Tuple[str, str]:
    from app.core import app_communication as comms
    first = employee_name.split(" ")[0] if employee_name else "there"
    return comms.render(db, "hours_correction", {
        "first_name": first,
        "employee_name": employee_name,
        "job_name": job_name,
        "work_date": work_date,
        "corrections": "\n\n".join(_correction_lines(cs)),
        "company_name": "Mountaineer Moving",
    })


def notify_job_corrections(db: Session, job_uuid: str) -> Dict[str, Any]:
    """Mail every un-notified correction on this job to the crew it affects.

    Called when a job is initialed on the Job Summary. Idempotent the same way
    finalize is: a correction is mailed once and stamped notified_at, so
    re-initialing a job does not re-send. Best-effort per employee - one bad
    address must not stop the rest - and it never raises: initialing is the
    admin's own checkpoint and must not be blocked by mail trouble. When email
    is unconfigured it reports that and leaves notified_at unset so a later,
    configured save still sends.
    """
    cs = (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.job_uuid == job_uuid,
            PayrollCorrection.notified_at.is_(None),
        )
        .all()
    )
    result: Dict[str, Any] = {"sent": [], "failed": [], "email_unconfigured": False}
    if not cs:
        return result
    if not os.getenv("POSTMARK_SERVER_TOKEN", "").strip() or not os.getenv(
        "SMTP_FROM", ""
    ).strip():
        result["email_unconfigured"] = True
        return result

    job_name = _job_label(db, job_uuid)
    work_date = _job_work_date(db, job_uuid).isoformat()
    by_user: Dict[int, List[PayrollCorrection]] = defaultdict(list)
    for c in cs:
        by_user[c.user_id].append(c)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # One query for the whole group instead of one per recipient. The loop is
    # bounded by the crew on a single job so the old shape was not a scale
    # problem, but it put a DB round-trip inside a loop that also sends mail,
    # and that is the pattern VETTING_PROTOCOL asks us not to leave lying around.
    users_by_id = {
        u.id: u for u in db.query(User).filter(User.id.in_(list(by_user.keys()))).all()
    } if by_user else {}
    for uid, group in by_user.items():
        user = users_by_id.get(uid)
        name = user.name if user else (group[0].user_name or "")
        if user is None or not user.email:
            result["failed"].append({
                "user_id": uid, "name": name, "count": len(group),
                "error": "no email address on the roster",
            })
            continue
        subject, text = _job_correction_email(db, name or user.email, job_name, work_date, group)
        try:
            send_email(to_email=user.email, subject=subject, text=text)
        except Exception as exc:
            result["failed"].append({
                "user_id": uid, "name": name, "count": len(group), "error": str(exc),
            })
            continue
        for c in group:
            c.notified_at = now
        result["sent"].append({"user_id": uid, "name": name, "count": len(group)})

    # Only corrections whose email actually went out carry a notified_at, so a
    # failure is retried by the next initialing rather than silently marked done.
    db.commit()
    return result


# ── Finalize (send the correction emails) ────────────────────────────────────

_BUCKET_LABELS = {
    "billable": "billable hours",
    "non_billable": "non-billable hours",
    "other": "other-pay hours",
    "per_diem_nights": "per-diem nights",
}


def _correction_lines(cs: List[PayrollCorrection]) -> List[str]:
    out = []
    for c in sorted(cs, key=lambda x: x.work_date):
        unit = "nights" if c.bucket == "per_diem_nights" else "hrs"
        label = _BUCKET_LABELS.get(c.bucket, c.bucket)
        where = c.source_label or c.source
        out.append(
            f"  {c.work_date}  {where}\n"
            f"    {label}: {c.original_hours:g} {unit} -> {c.corrected_hours:g} {unit}\n"
            f"    Reason: {c.reason}"
        )
    return out


def _finalize_email(
    db: Session, employee_name: str, start: date, end: date, cs: List[PayrollCorrection]
) -> Tuple[str, str]:
    from app.core import app_communication as comms
    return comms.render(db, "payroll_finalize", {
        "first_name": employee_name.split(" ")[0] if employee_name else "there",
        "employee_name": employee_name,
        "period": f"{start.isoformat()} to {end.isoformat()}",
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "corrections": "\n\n".join(_correction_lines(cs)),
        "company_name": "Mountaineer Moving",
    })


@router.post("/finalize")
def finalize_period(
    body: PayrollFinalizeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Mail every un-notified correction for the period to the crew it affects.

    Idempotent by design: a correction is mailed once, stamped with notified_at,
    and skipped on any later finalize. An admin who corrects one more thing after
    finalizing re-runs this and only the new correction goes out - nobody gets
    the same batch twice.

    Sends are per-employee and best-effort: one crew member's bad address must
    not stop the rest of the crew being told. Failures come back in the response
    so the admin sees them rather than assuming silence means success.
    """
    s, e = _parse_period(body.period_start, body.period_end)
    suppress = set(body.suppress_user_ids or [])

    # Review gate (ADR 0032): every job that feeds this period must be reviewed +
    # initialed on the Job Summary first. Reuse the summary so the gate's job set
    # is exactly what the admin sees. Block before touching anything.
    pending_review = _build_summary(db, s, e)["jobs_pending_review"]
    if pending_review:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{len(pending_review)} job(s) in this period still need review + "
                "initialing in the Job Summary before payroll can be finalized: "
                + ", ".join(p["job_name"] or p["job_uuid"][:8] for p in pending_review)
            ),
        )

    # Un-reviewed reimbursements WARN, they do not block. Payroll pays anything
    # not explicitly declined, so an unreviewed claim is already being paid -
    # blocking here would stop payroll over money that is going out either way.
    # But finishing a period without anyone having looked at the claims is worth
    # saying out loud, so it comes back in the response.
    summary_for_warn = _build_summary(db, s, e)
    unreviewed = [
        {"name": emp["name"], "count": emp.get("reimbursements_unreviewed", 0)}
        for emp in summary_for_warn["employees"]
        if emp.get("reimbursements_unreviewed", 0)
    ]

    # The mailer falls back to printing to stdout when Postmark is unconfigured
    # (that fallback is what lets the backend boot without secrets). It does NOT
    # raise, so without this guard finalize would report every send as a success
    # and stamp notified_at - permanently marking crew as told about a
    # correction that was never sent to them. Fail before touching anything.
    if not os.getenv("POSTMARK_SERVER_TOKEN", "").strip() or not os.getenv(
        "SMTP_FROM", ""
    ).strip():
        raise HTTPException(
            status_code=503,
            detail=(
                "Email is not configured on this server (POSTMARK_SERVER_TOKEN / "
                "SMTP_FROM), so nobody would actually be notified. Corrections "
                "have been left unsent."
            ),
        )

    pending = (
        db.query(PayrollCorrection)
        .filter(
            # Period-scoped rows only. Job corrections are mailed when their job
            # is initialed on the Job Summary, not from here (ADR 0032), so a
            # period finalize must not also mail them - that would double-notify.
            PayrollCorrection.job_uuid.is_(None),
            PayrollCorrection.period_start == s.isoformat(),
            PayrollCorrection.period_end == e.isoformat(),
            PayrollCorrection.notified_at.is_(None),
        )
        .all()
    )

    by_user: Dict[int, List[PayrollCorrection]] = defaultdict(list)
    for c in pending:
        by_user[c.user_id].append(c)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    sent: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    suppressed: List[Dict[str, Any]] = []

    # Same preload as the per-job path above: one query, not one per recipient.
    users_by_id = {
        u.id: u for u in db.query(User).filter(User.id.in_(list(by_user.keys()))).all()
    } if by_user else {}
    for uid, cs in by_user.items():
        user = users_by_id.get(uid)
        name = user.name if user else (cs[0].user_name or "")
        if uid in suppress:
            # Marked as already discussed in person. Stamp them notified so the
            # next finalize does not mail what the admin deliberately withheld.
            for c in cs:
                c.notified_at = now
            suppressed.append({"user_id": uid, "name": name, "count": len(cs)})
            continue
        if user is None or not user.email:
            failed.append({
                "user_id": uid, "name": name, "count": len(cs),
                "error": "no email address on the roster",
            })
            continue
        subject, text = _finalize_email(db, name or user.email, s, e, cs)
        try:
            send_email(to_email=user.email, subject=subject, text=text)
        except Exception as exc:
            failed.append({
                "user_id": uid, "name": name, "count": len(cs), "error": str(exc),
            })
            continue
        for c in cs:
            c.notified_at = now
        sent.append({"user_id": uid, "name": name, "count": len(cs)})

    # Finalizing a period advances the crew's "current pay period": their Worked
    # Hours summary now runs from the day after this period's end.
    set_last_finalized_period(db, s, e)

    # Committed after the loop: only the corrections whose email actually went
    # out (or was deliberately suppressed) carry a notified_at, so a failure is
    # retried by the next finalize instead of being silently marked done.
    db.commit()

    return {
        "period": {"start": s.isoformat(), "end": e.isoformat()},
        "sent": sent,
        "suppressed": suppressed,
        "failed": failed,
        # Advisory only. See the note where this is built: these claims are being
        # paid, so this is "nobody looked", not "something is wrong".
        "reimbursements_unreviewed": unreviewed,
    }


# ── Reimbursement approve / decline ──────────────────────────────────────────

@router.post("/reimbursement/{reimbursement_uuid}/decision")
def decide_reimbursement(
    reimbursement_uuid: str,
    body: ReimbursementDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Approve or decline one claim, and tell the crew member when it is declined.

    Payroll pays everything except what is explicitly declined (see
    `_reimbursements_for_period`), so approving is really "reviewed, and it
    stands" while declining is the action that changes money. Both are recorded
    so the payroll screen can show who decided and when.

    The decline email is best-effort and its failure does NOT roll back the
    decision. The alternative - refusing to record a decline because the crew
    member's mailbox bounced - would leave a claim being paid that an admin has
    already judged wrong. The response says whether the mail went, so the admin
    can follow up by hand rather than assume.
    """
    row = (
        db.query(Reimbursement)
        .filter(Reimbursement.reimbursement_uuid == reimbursement_uuid)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Reimbursement not found")

    previous = (row.status or "submitted").strip() or "submitted"
    row.status = body.status
    row.approval_notes = body.note or None
    if body.status == "submitted":
        # Back to undecided: clear the decision trail rather than leaving a
        # stale approver on a claim nobody has currently decided.
        row.approver_id = None
        row.approver_name = None
        row.approved_at = None
    else:
        row.approver_id = current_user.id
        row.approver_name = current_user.name or current_user.email
        row.approved_at = datetime.utcnow()
    db.commit()

    # RE-EXPORT, or the Sheet keeps saying "submitted" forever.
    #
    # The Reimbursements tab has carried status / approver / approved_at /
    # approval_notes since the feature shipped, and the export is replace-style
    # keyed on reimbursement_uuid, so this rewrites the row in place. What was
    # missing was anyone calling it after a DECISION: the only export was on
    # submit, so the Sheet recorded every claim as undecided no matter what the
    # office did to it. The Sheet is the durable record and Postgres is not, so
    # that gap meant the decision existed in exactly one place.
    #
    # Imported here rather than at module scope: reimbursement.py imports from
    # payroll's neighbourhood and a top-level import risks a cycle. Reusing ITS
    # payload builder is the point - a second hand-written dict would drift from
    # the submit path the first time a column is added.
    from app.routers.reimbursement import _queue_export
    _queue_export(row)

    emailed = False
    email_error: Optional[str] = None
    # Only on a NEW decline. Re-saving a note on an already-declined claim must
    # not re-mail the crew member about a decision they were already told about.
    if body.status == "rejected" and previous != "rejected":
        user = db.query(User).filter(User.id == row.user_id).first() if row.user_id else None
        if not user or not (user.email or "").strip():
            email_error = "no email address on file for this crew member"
        else:
            what = (
                f"{row.vendor or row.category or 'expense'}"
                f"{f' for ${float(row.amount):.2f}' if row.amount is not None else ''}"
                if row.type != "mileage"
                else "mileage claim"
            )
            when = row.expense_date or (
                row.created_at.date().isoformat() if row.created_at else "an earlier date"
            )
            text = (
                f"Hi {user.name or ''},\n\n"
                f"Your {what} dated {when} was not approved for reimbursement, so "
                f"it will not appear on your pay.\n\n"
                + (f"Reason given: {body.note}\n\n" if body.note else "")
                + "If you think this is wrong, reply to this email or speak to the "
                "office - nothing has been deleted and it can be reinstated.\n"
            )
            try:
                send_email(
                    to_email=user.email,
                    subject="A reimbursement claim was not approved",
                    text=text,
                )
                emailed = True
            except Exception as exc:  # noqa: BLE001 - see docstring
                email_error = str(exc)

    return {
        "ok": True,
        "uuid": reimbursement_uuid,
        "status": row.status,
        "approver": row.approver_name or "",
        "emailed": emailed,
        "email_error": email_error,
    }


# ── Job-report waiver ────────────────────────────────────────────────────────


def _waiver_export_dict(db: Session, row: AdminEntryStatus) -> dict:
    """One payload builder, shared by the endpoint and the backfill re-driver.

    A second hand-written dict at the backfill site would drift from this one the
    first time a column is added, and the drift would show up as a re-driven row
    that quietly differs from the row the live path writes.

    `_job_label` falls back to the first 8 characters of the uuid when a job has
    no events to name it - which is common here, since these are precisely the
    jobs nobody filed paperwork for.
    """
    return {
        "job_uuid": row.job_uuid,
        "job_name": _job_label(db, row.job_uuid),
        "waived": bool(row.report_waived),
        "waived_by_name": row.report_waived_by_name or "",
        "waived_at": row.report_waived_at,
        "reason": row.report_waived_reason or "",
        "entered_by": row.entered_by or "",
        "entered_on": row.entered_on or "",
        "updated_at": row.updated_at,
    }


def _queue_waiver_export(db: Session, row: AdminEntryStatus) -> None:
    from app.integrations.sheets_export import (
        export_report_waiver_to_sheets,
        run_export_in_background,
    )
    run_export_in_background(export_report_waiver_to_sheets, _waiver_export_dict(db, row))

@router.post("/job/{job_uuid}/report-waiver")
def set_report_waiver(
    job_uuid: str,
    body: ReportWaiverRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Waive the job-report requirement for one job so payroll can finalize.

    The gate exists to stop payroll running over unreviewed work, and it is
    right to keep it. But some jobs never get a report by design - off-job hours
    logged against a manual job, an unpaid drive leg - and those blocked the
    period indefinitely waiting for something nobody was going to file.

    Per job and explicit, never a global switch: a blanket "ignore report-less
    jobs" would retire the gate rather than handle the exception. The waiver
    records who granted it and why, so a period that finalized over a missing
    report can be explained months later.
    """
    row = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
    if row is None:
        if not body.waived:
            return {"ok": True, "job_uuid": job_uuid, "waived": False}
        # A report-less job usually has no entry-status row yet, so create one.
        # entered_by / entered_on are NOT NULL and are the admin's attestation
        # fields; a waiver is not an attestation, so they are marked as such
        # rather than borrowing the admin's initials and implying a review.
        row = AdminEntryStatus(
            job_uuid=job_uuid,
            entered_by="(waived)",
            entered_on=datetime.now(MOUNTAIN_TZ).date().isoformat(),
            updated_at=datetime.utcnow(),
        )
        db.add(row)

    row.report_waived = bool(body.waived)
    row.report_waived_reason = (body.reason or None) if body.waived else None
    row.report_waived_by_name = (
        (current_user.name or current_user.email) if body.waived else None
    )
    row.report_waived_at = datetime.utcnow() if body.waived else None
    row.updated_at = datetime.utcnow()
    db.commit()

    # The waiver is the record of an admin letting payroll finalize over missing
    # paperwork. Until now it lived only in Postgres, so the single artifact
    # explaining why a period closed without a report was also the only one with
    # no durable copy. Exported on BOTH waive and un-waive: a revoked waiver
    # writes back as "not waived" rather than vanishing, because a waiver that
    # was granted and then taken back is a thing that happened.
    _queue_waiver_export(db, row)
    return {
        "ok": True,
        "job_uuid": job_uuid,
        "waived": bool(row.report_waived),
        "reason": row.report_waived_reason or "",
        "by": row.report_waived_by_name or "",
    }
