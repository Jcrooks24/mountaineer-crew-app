"""
Crew Resources daily calendar event.

Each day generates a "Crew Resources" event on the Office calendar from
5:00 to 6:00 AM Mountain Time. The event's description summarizes who's
available that day — grouped by tier (Tier I → IV → Other) and calling out
crew leads — and updates as employees get added to job events on the Jobs
calendar.

Read-side: pulls availability_days for the date, joined with employee_tags
to resolve tier + crew-lead status. Pulls attendees from every event on
JOBS_CALENDAR_ID for that date so scheduled blocks show up next to names.

Write-side: looks up the existing Crew Resources event by querying the
Office calendar for "Crew Resources" on the target date. If present, patch
its description. If absent, create a fresh one.

Env vars:
  WORKSPACE_CALENDAR_ID — Office calendar (read+write the Crew Resources event)
  JOBS_CALENDAR_ID      — Jobs calendar (read attendees only)
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


def _office_calendar_id() -> str:
    return (os.getenv("WORKSPACE_CALENDAR_ID") or "").strip()


def _jobs_calendar_id() -> str:
    return (os.getenv("JOBS_CALENDAR_ID") or "").strip()


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
    tag IDs. Returns a list of {user_id, name, email, status, tag_ids}.

    'unavailable' is excluded — they shouldn't appear in the Crew Resources
    roster. 'conditional' stays in with a flag so the description can mark
    them clearly.
    """
    day_iso = target.isoformat()
    rows = (
        db.query(
            User.id,
            User.email,
            User.name,
            AvailabilityDay.status,
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
) -> str:
    """Compose the Crew Resources event description.

    Unscheduled crew group first (by tier, leads called out), then
    scheduled crew. Empty groups are omitted.
    """
    header = target.strftime("CREW RESOURCES — %A, %B %-d") if os.name != "nt" else (
        target.strftime("CREW RESOURCES — %A, %B %d")
    )

    unscheduled_by_tier: Dict[Optional[str], List[Dict[str, Any]]] = defaultdict(list)
    scheduled_rows: List[Tuple[Optional[str], Dict[str, Any], str]] = []

    for emp in available:
        tier, is_lead = _tier_and_lead(emp["tag_ids"], tags_by_id)
        blocks = scheduled.get(emp["email"]) or []
        if blocks:
            scheduled_rows.append((tier, {**emp, "is_lead": is_lead, "tier": tier}, _format_blocks(blocks)))
        else:
            unscheduled_by_tier[tier].append({**emp, "is_lead": is_lead})

    lines: List[str] = [header, ""]

    if unscheduled_by_tier:
        lines.append("—— UNSCHEDULED ——")
        lines.append("")
        for tier in sorted(unscheduled_by_tier.keys(), key=_tier_sort_key):
            people = unscheduled_by_tier[tier]
            # Crew leads first within each tier, then alphabetical by name.
            people.sort(key=lambda p: (not p["is_lead"], p["name"].lower()))
            lines.append(tier or "Other / Untagged")
            for p in people:
                lead_mark = "★ " if p["is_lead"] else "  "
                cond = " (conditional)" if p["status"] == "conditional" else ""
                lines.append(f"  {lead_mark}{p['name']}{cond}")
            lines.append("")

    if scheduled_rows:
        lines.append("—— SCHEDULED ——")
        lines.append("")
        # Scheduled section is flat: name (tier, role) — blocks
        scheduled_rows.sort(key=lambda x: (_tier_sort_key(x[0]), x[1]["name"].lower()))
        for tier, p, blocks_text in scheduled_rows:
            tier_text = tier or "Other"
            role = ", lead" if p["is_lead"] else ""
            cond = " ⚠ conditional" if p["status"] == "conditional" else ""
            lines.append(f"{p['name']} ({tier_text}{role}){cond} — {blocks_text}")

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
    office_id = _office_calendar_id()
    if not office_id:
        return {"ok": False, "reason": "WORKSPACE_CALENDAR_ID missing"}

    available = _available_employees(db, target)
    tags = {t.id: t for t in db.query(EmployeeTag).all()}

    svc = _get_calendar_svc(db)
    jobs_id = _jobs_calendar_id()
    scheduled = _scheduled_by_email(svc, jobs_id, target) if jobs_id else {}

    description = build_description(target, available, tags, scheduled)

    event_id = _find_crew_resources_event_id(svc, office_id, target)
    created = False
    if event_id:
        _patch_crew_resources_event(svc, office_id, event_id, description)
    else:
        event_id = _create_crew_resources_event(svc, office_id, target, description)
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
