"""Mountain-time helpers for operations on event timestamps.

Event timestamps in `events.timestamp` and `events.logged_at` are stored
as naive `DateTime` columns in UTC (that's what /api/sync writes after
parsing the device-provided ISO). Crew operate in Bozeman (Mountain),
and any "what day did this happen?" question must be answered in
Mountain - otherwise events logged after ~5 PM MT roll over to the next
UTC date and disappear from "today" filters / "events on 2026-05-01"
searches.

Use these helpers any time the answer to "which calendar day does this
timestamp belong to?" matters. They are NOT for display formatting -
that's `lib/time.ts` on the frontend.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import Date, cast, func


MOUNTAIN_TZ = ZoneInfo("America/Denver")
_MOUNTAIN_TZ_NAME = "America/Denver"


def utc_naive_to_mountain_date(dt: datetime) -> date:
    """Treat a naive-UTC datetime as UTC, return its calendar date in MT."""
    return dt.replace(tzinfo=timezone.utc).astimezone(MOUNTAIN_TZ).date()


def mountain_day_utc_bounds(d: Optional[date] = None) -> Tuple[datetime, datetime]:
    """Return [start, end) of the Mountain calendar day `d` (default today),
    expressed as naive UTC datetimes - ready to compare against
    `events.timestamp` directly.

    DST-safe: the start and end are computed in MT first and then converted,
    so they always span exactly one local day even on transition days.
    """
    target = d or datetime.now(MOUNTAIN_TZ).date()
    start_mt = datetime(target.year, target.month, target.day, tzinfo=MOUNTAIN_TZ)
    end_mt = start_mt + timedelta(days=1)
    start_utc = start_mt.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_mt.astimezone(timezone.utc).replace(tzinfo=None)
    return start_utc, end_utc


def mountain_date_expr(timestamp_col):
    """SQLAlchemy expression returning the Mountain calendar date of a
    naive-UTC timestamp column. Use in `.filter(...)` clauses to compare
    against a YYYY-MM-DD string the user supplied.

    Postgres semantics:
        timestamp AT TIME ZONE 'UTC'           -- interpret as UTC, get timestamptz
        AT TIME ZONE 'America/Denver'          -- convert to MT, get naive timestamp in MT
        ::date                                 -- truncate to date

    SQLAlchemy emits this as nested timezone() calls.
    """
    return cast(
        func.timezone(_MOUNTAIN_TZ_NAME, func.timezone("UTC", timestamp_col)),
        Date,
    )
