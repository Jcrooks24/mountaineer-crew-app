"""
Crew Resources daily calendar event.

Each day generates a "Crew Resources" event on a dedicated Resources
calendar from 5:00 to 6:00 AM Mountain Time. The event's description
summarizes who's available that day — grouped by tier (Tier I → IV →
Other) and calling out crew leads — and updates as employees get added
as attendees to events on the Jobs calendar.

Read-side: pulls availability_days for the date, joined with employee_tags
to resolve tier + crew-lead status. Pulls attendees from every event on
the Jobs calendar for that date so scheduled blocks show up next to names.

Write-side: looks up the existing Crew Resources event by querying the
Resources calendar for "Crew Resources" on the target date. If present,
patch its description. If absent, create a fresh one.

Env vars:
  RESOURCES_CALENDAR_ID  — Resources calendar (read+write the Crew Resources event)
  WORKSPACE_CALENDAR_ID  — Jobs calendar (read attendees from here; default for jobs)
  JOBS_CALENDAR_ID       — optional override if jobs ever move to a separate calendar
  CREW_RESOURCES_ENABLED — "true" to enable; default off

OAuth: requires the calendar.events scope. Admin re-authorizes via
/api/admin/cal-token after the scope bump in google_cal_oauth.py.
"""

from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.google_cal_oauth import LOCAL_TZ, _build_authorized_http, _get_creds, _ssl_retry
from app.db.models.availability import AvailabilityDay
from app.db.models.employee_tag import EmployeeTag, user_employee_tags
from app.db.models.user import User


CREW_RESOURCES_TITLE = "Crew Resources"


# ── Small helpers ───────────────────────────────────────────────────────────


def _is_enabled() -> bool:
    return os.getenv("CREW_RESOURCES_ENABLED", "").strip().lower() == "true"


def _resources_calendar_id() -> str:
    """The dedicated Resources calendar where the daily Crew Resources event
    lives. Distinct from the Jobs calendar so admin can grant/revoke crew
    access to it independently."""
    return (os.getenv("RESOURCES_CALENDAR_ID") or "").strip()


def _jobs_calendar_id() -> str:
    """The calendar to scan for job-event attendees. Prefers JOBS_CALENDAR_ID
    so admin can split jobs onto a separate calendar later without rewiring;
    falls back to WORKSPACE_CALENDAR_ID which already points at the Jobs
    calendar in the current deploy."""
    explicit = (os.getenv("JOBS_CALENDAR_ID") or "").strip()
    if explicit:
        return explicit
    return (os.getenv("WORKSPACE_CALENDAR_ID") or "").strip()


def _format_time(dt_str: Optional[str]) -> str:
    """Format an ISO datetime (with tz) as 'h:mm AM/PM' in local TZ. Returns
    empty string on missing or unparseable input — caller decides whether
    that's a falsy 'all day' or just a skip."""
    if not dt_str:
        return ""
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        dt_local = dt.astimezone(LOCAL_TZ)
        return dt_local.strftime("%-I:%M %p") if os.name != "nt" else dt_local.strftime(
            "%I:%M %p"
        ).lstrip("0")
    except Exception:
        return ""


# ── Calendar service ────────────────────────────────────────────────────────


def _get_calendar_svc(db: Session) -> Any:
    """Fresh calendar svc per call. Background loop runs every hour so we
    don't bother caching across cycles — keeps memory predictable."""
    from googleapiclient.discovery import build
    creds = _get_creds(db)
    authorized_http = _build_authorized_http(creds)
    return build("calendar", "v3", http=authorized_http, cache_discovery=False)


def _day_bounds(target: date) -> Tuple[datetime, datetime]:
    """Return (start_of_day, end_of_day) in local TZ — used to time-bound
    the events.list query when scanning the Jobs calendar."""
    start_local = datetime.combine(target, time(0, 0, 0), tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local


# ── Read: availability + tags ───────────────────────────────────────────────


def _available_employees(db: Session, target: date) -> List[Dict[str, Any]]:
    """Crew available (or conditional) for the day, joined with each user's
    tag IDs. Returns a list of {user_id, name, email, status, note, tag_ids}.

    'unavailable' is excluded — they shouldn't appear in the Crew Resources
    roster. 'conditional' stays in with a flag so the description can mark
    them clearly. The crew member's per-day note flows through so the
    description can show context like "available after 1pm".
    """
    day_iso = target.isoformat()
    rows = (
        db.query(
            User.id,
            User.email,
            User.name,
            AvailabilityDay.status,
            AvailabilityDay.note,
        )
        .join(AvailabilityDay, AvailabilityDay.user_id == User.id)
        .filter(
            AvailabilityDay.day == day_iso,
            AvailabilityDay.status.in_(("available", "conditional")),
            User.is_active.is_(True),
        )
        .all()
    )
    if not rows:
        return []

    user_ids = [r.id for r in rows]
    tag_rows = db.execute(
        select(user_employee_tags.c.user_id, user_employee_tags.c.tag_id)
        .where(user_employee_tags.c.user_id.in_(user_ids))
    ).all()
    tags_by_user: Dict[int, List[int]] = defaultdict(list)
    for r in tag_rows:
        tags_by_user[r.user_id].append(r.tag_id)

    return [
        {
            "user_id": r.id,
            "email": (r.email or "").strip().lower(),
            "name": r.name or r.email or "(no name)",
            "status": r.status,
            "note": (r.note or "").strip(),
            "tag_ids": tags_by_user.get(r.id, []),
        }
        for r in rows
    ]


def _tier_and_lead(
    tag_ids: List[int], tags_by_id: Dict[int, EmployeeTag]
) -> Tuple[Optional[str], bool]:
    """Resolve (tier_name, is_crew_lead) from a user's tag IDs. If the user
    has multiple Tier tags (admin probably misconfigured), pick the one with
    the lowest sort_order — that's the canonical ordering admin set up."""
    is_lead = False
    tier_candidates: List[EmployeeTag] = []
    for tid in tag_ids:
        t = tags_by_id.get(tid)
        if not t:
            continue
        if t.name == "Crew Lead":
            is_lead = True
        elif t.name.startswith("Tier "):
            tier_candidates.append(t)
    tier = None
    if tier_candidates:
        tier_candidates.sort(key=lambda t: (t.sort_order, t.name))
        tier = tier_candidates[0].name
    return tier, is_lead


# ── Read: scheduled blocks from Jobs calendar ──────────────────────────────


def _prior_week_hours(
    svc: Any, jobs_calendar_id: str, target: date
) -> Dict[str, float]:
    """Sum scheduled hours per attendee email across all events on the Jobs
    calendar in the 7 days *before* target (target itself excluded). Used
    to show "X.Xh last 7d" next to each crew member in the description so
    the office can see at a glance who's been heavily loaded.

    All-day events are skipped — they don't have a defined duration the
    way a moving-job event does. Declined attendees are skipped. Multi-day
    events are clipped to the prior-7-day window, so a job that runs
    into target day only contributes its pre-target portion.
    """
    if not jobs_calendar_id:
        return {}

    end_local = datetime.combine(target, time(0, 0, 0), tzinfo=LOCAL_TZ)
    start_local = end_local - timedelta(days=7)

    def _fetch():
        return (
            svc.events()
            .list(
                calendarId=jobs_calendar_id,
                timeMin=start_local.isoformat(),
                timeMax=end_local.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=500,
            )
            .execute()
        )

    resp = _ssl_retry(_fetch)
    items = resp.get("items", [])
    out: Dict[str, float] = defaultdict(float)
    for it in items:
        attendees = it.get("attendees") or []
        if not attendees:
            continue
        start_str = it.get("start", {}).get("dateTime")
        end_str = it.get("end", {}).get("dateTime")
        if not start_str or not end_str:
            continue  # all-day event — no measurable duration
        try:
            s = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            e = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
        except ValueError:
            continue
        # Clip to the prior-7d window so a job overlapping target day
        # doesn't inflate today's number.
        clipped_start = max(s, start_local)
        clipped_end = min(e, end_local)
        hours = max(0.0, (clipped_end - clipped_start).total_seconds() / 3600.0)
        if hours <= 0:
            continue
        for a in attendees:
            email = (a.get("email") or "").strip().lower()
            if not email:
                continue
            if a.get("responseStatus") == "declined":
                continue
            out[email] += hours
    return dict(out)


def _format_prior_hours(h: float) -> str:
    """Pretty-print prior-week hours. One decimal so 32 hours stays compact
    and a 5.5-hour week is still readable."""
    return f"{h:.1f}h last 7d"


def _scheduled_by_email(
    svc: Any, jobs_calendar_id: str, target: date
) -> Dict[str, List[Dict[str, str]]]:
    """For each attendee email on jobs events that day, collect a list of
    {start, end, title} blocks. start/end are pre-formatted local-time strings.
    All-day events appear as start='All day', end=''."""
    if not jobs_calendar_id:
        return {}

    start_local, end_local = _day_bounds(target)

    def _fetch():
        return (
            svc.events()
            .list(
                calendarId=jobs_calendar_id,
                timeMin=start_local.isoformat(),
                timeMax=end_local.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
            )
            .execute()
        )

    resp = _ssl_retry(_fetch)
    items = resp.get("items", [])
    out: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    for it in items:
        attendees = it.get("attendees") or []
        if not attendees:
            continue
        title = (it.get("summary") or "(no title)").strip()
        start_dt = it.get("start", {})
        end_dt = it.get("end", {})
        start_str = _format_time(start_dt.get("dateTime")) or ("All day" if start_dt.get("date") else "")
        end_str = _format_time(end_dt.get("dateTime"))
        block = {"start": start_str, "end": end_str, "title": title}
        for a in attendees:
            email = (a.get("email") or "").strip().lower()
            if not email:
                continue
            # Skip declined attendees — they aren't actually working it.
            if a.get("responseStatus") == "declined":
                continue
            out[email].append(block)
    return out


# ── Description builder ────────────────────────────────────────────────────


def _format_blocks(blocks: List[Dict[str, str]]) -> str:
    parts: List[str] = []
    for b in blocks:
        s, e, t = b["start"], b["end"], b["title"]
        if s and e:
            parts.append(f"{s}–{e} ({t})")
        elif s:
            parts.append(f"{s} ({t})")
        else:
            parts.append(f"({t})")
    return ", ".join(parts)


def _tier_sort_key(tier: Optional[str]) -> Tuple[int, str]:
    """Order Tier I → II → III → IV → Other (None last). Anything else
    falls into 'Other' alphabetically. Returns (bucket, name) for stable sort."""
    if tier is None:
        return (99, "Other")
    if tier.startswith("Tier "):
        # Roman numerals in the tier suffix — convert to int for ordering.
        roman = tier[5:].strip()
        roman_map = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
        return (roman_map.get(roman, 50), tier)
    return (90, tier)


def build_description(
    target: date,
    available: List[Dict[str, Any]],
    tags_by_id: Dict[int, EmployeeTag],
    scheduled: Dict[str, List[Dict[str, str]]],
    prior_hours: Dict[str, float],
) -> str:
    """Compose the Crew Resources event description.

    Sections, in order:
      UNSCHEDULED — crew marked available who aren't on any job today
                    (grouped by tier, leads first, then alphabetical).
      CONDITIONAL — every conditional crew member regardless of whether
                    they have a job today. Their per-day note + scheduled
                    blocks (if any) appear with the row so the office can
                    decide whether to lean on them.
      SCHEDULED   — crew marked available who are on at least one job
                    today (flat list sorted by tier then name).

    Every row carries the crew member's total scheduled hours in the
    seven days *before* target, so admin can see at a glance who's
    overworked or underused.
    """
    header = target.strftime("CREW RESOURCES — %A, %B %-d") if os.name != "nt" else (
        target.strftime("CREW RESOURCES — %A, %B %d")
    )

    unscheduled_by_tier: Dict[Optional[str], List[Dict[str, Any]]] = defaultdict(list)
    conditional_rows: List[Dict[str, Any]] = []
    scheduled_rows: List[Dict[str, Any]] = []

    for emp in available:
        tier, is_lead = _tier_and_lead(emp["tag_ids"], tags_by_id)
        blocks = scheduled.get(emp["email"]) or []
        hours = prior_hours.get(emp["email"], 0.0)
        entry = {
            **emp,
            "is_lead": is_lead,
            "tier": tier,
            "prior_hours": hours,
            "blocks_text": _format_blocks(blocks) if blocks else "",
        }
        if emp["status"] == "conditional":
            # Conditional crew get their own section regardless of whether
            # they're already on a job — the note matters in both cases.
            conditional_rows.append(entry)
        elif blocks:
            scheduled_rows.append(entry)
        else:
            unscheduled_by_tier[tier].append(entry)

    lines: List[str] = [header, ""]

    if unscheduled_by_tier:
        lines.append("—— UNSCHEDULED ——")
        lines.append("")
        for tier in sorted(unscheduled_by_tier.keys(), key=_tier_sort_key):
            people = unscheduled_by_tier[tier]
            people.sort(key=lambda p: (not p["is_lead"], p["name"].lower()))
            lines.append(tier or "Other / Untagged")
            for p in people:
                lead_mark = "★ " if p["is_lead"] else "  "
                hours_part = f" — {_format_prior_hours(p['prior_hours'])}"
                note = p.get("note") or ""
                note_part = f' — "{note}"' if note else ""
                lines.append(f"  {lead_mark}{p['name']}{hours_part}{note_part}")
            lines.append("")

    if conditional_rows:
        lines.append("—— CONDITIONAL ——")
        lines.append("")
        conditional_rows.sort(key=lambda x: (_tier_sort_key(x["tier"]), x["name"].lower()))
        for p in conditional_rows:
            tier_text = p["tier"] or "Other"
            role = ", lead" if p["is_lead"] else ""
            hours_part = f" — {_format_prior_hours(p['prior_hours'])}"
            sched_part = f" — scheduled {p['blocks_text']}" if p["blocks_text"] else ""
            note = p.get("note") or ""
            note_part = f' — "{note}"' if note else ""
            lines.append(f"  {p['name']} ({tier_text}{role}){hours_part}{sched_part}{note_part}")
        lines.append("")

    if scheduled_rows:
        lines.append("—— SCHEDULED ——")
        lines.append("")
        scheduled_rows.sort(key=lambda x: (_tier_sort_key(x["tier"]), x["name"].lower()))
        for p in scheduled_rows:
            tier_text = p["tier"] or "Other"
            role = ", lead" if p["is_lead"] else ""
            hours_part = f" — {_format_prior_hours(p['prior_hours'])}"
            note = p.get("note") or ""
            note_part = f' — note: "{note}"' if note else ""
            lines.append(
                f"{p['name']} ({tier_text}{role}){hours_part} — {p['blocks_text']}{note_part}"
            )

    return "\n".join(lines).rstrip() + "\n"


# ── Event find / create / update ────────────────────────────────────────────


def _find_crew_resources_event_id(
    svc: Any, calendar_id: str, target: date
) -> Optional[str]:
    """Query the Office calendar for an event titled 'Crew Resources' inside
    target's day. Returns the event_id or None.

    Title comparison is case-insensitive to be friendly if admin renames
    the event manually for one day."""
    start_local, end_local = _day_bounds(target)

    def _fetch():
        return (
            svc.events()
            .list(
                calendarId=calendar_id,
                timeMin=start_local.isoformat(),
                timeMax=end_local.isoformat(),
                singleEvents=True,
                q=CREW_RESOURCES_TITLE,
                maxResults=10,
            )
            .execute()
        )

    resp = _ssl_retry(_fetch)
    for it in resp.get("items", []):
        summary = (it.get("summary") or "").strip().lower()
        if summary == CREW_RESOURCES_TITLE.lower():
            return it.get("id")
    return None


def _create_crew_resources_event(
    svc: Any, calendar_id: str, target: date, description: str
) -> str:
    """Create a fresh 5–6 AM Crew Resources event on the Office calendar."""
    start_local = datetime.combine(target, time(5, 0, 0), tzinfo=LOCAL_TZ)
    end_local = datetime.combine(target, time(6, 0, 0), tzinfo=LOCAL_TZ)
    body = {
        "summary": CREW_RESOURCES_TITLE,
        "description": description,
        "start": {"dateTime": start_local.isoformat(), "timeZone": str(LOCAL_TZ)},
        "end": {"dateTime": end_local.isoformat(), "timeZone": str(LOCAL_TZ)},
    }

    def _do():
        return svc.events().insert(calendarId=calendar_id, body=body).execute()

    resp = _ssl_retry(_do)
    return resp["id"]


def _patch_crew_resources_event(
    svc: Any, calendar_id: str, event_id: str, description: str
) -> None:
    """PATCH only the description so manual edits to title / start / end /
    location are preserved across daily refreshes."""
    def _do():
        return (
            svc.events()
            .patch(
                calendarId=calendar_id,
                eventId=event_id,
                body={"description": description},
            )
            .execute()
        )

    _ssl_retry(_do)


# ── Public entrypoint ───────────────────────────────────────────────────────


def update_crew_resources_for_day(db: Session, target: date) -> Dict[str, Any]:
    """Idempotent: ensure target's Crew Resources event exists with the
    current description. Returns a status dict for the caller to log."""
    if not _is_enabled():
        return {"ok": False, "reason": "disabled"}
    resources_id = _resources_calendar_id()
    if not resources_id:
        return {"ok": False, "reason": "RESOURCES_CALENDAR_ID missing"}

    available = _available_employees(db, target)
    tags = {t.id: t for t in db.query(EmployeeTag).all()}

    svc = _get_calendar_svc(db)
    jobs_id = _jobs_calendar_id()
    scheduled = _scheduled_by_email(svc, jobs_id, target) if jobs_id else {}
    prior_hours = _prior_week_hours(svc, jobs_id, target) if jobs_id else {}

    description = build_description(target, available, tags, scheduled, prior_hours)

    event_id = _find_crew_resources_event_id(svc, resources_id, target)
    created = False
    if event_id:
        _patch_crew_resources_event(svc, resources_id, event_id, description)
    else:
        event_id = _create_crew_resources_event(svc, resources_id, target, description)
        created = True

    return {
        "ok": True,
        "date": target.isoformat(),
        "event_id": event_id,
        "created": created,
        "available_count": len(available),
        "scheduled_count": sum(1 for a in available if scheduled.get(a["email"])),
    }


def update_crew_resources_for_horizon(db: Session, days_ahead: int = 14) -> List[Dict[str, Any]]:
    """Refresh Crew Resources events for today through today + days_ahead.
    Used by the hourly loop."""
    today = datetime.now(LOCAL_TZ).date()
    results: List[Dict[str, Any]] = []
    for i in range(days_ahead + 1):
        d = today + timedelta(days=i)
        try:
            results.append(update_crew_resources_for_day(db, d))
        except Exception as exc:
            results.append({"ok": False, "date": d.isoformat(), "error": str(exc)})
    return results
