"""
Reconciliation between the events table and the Events sheet tab.

The /api/sync path writes to Postgres first and the Google Sheet best-effort.
If the Sheets append fails (Google blip, expired creds, transient SSL error
past _ssl_retry's budget), the event stays in `events` but never lands in
`sheet_event_exports`, and nothing retries — the device drops the event from
its outbox the moment the server returns ok=True.

This module finds those orphans and ships them through the existing exporter,
which is idempotent thanks to the `sheet_event_exports` dedupe table.

Used by:
- POST /api/admin/sheets/reconcile-events  (admin-triggered Refresh button)
- backend/scripts/reconcile_events.py       (cron / manual one-shot)
"""

from __future__ import annotations

import time as _time
from typing import Any, Dict, List

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.integrations.sheets_export import export_events_to_sheets


_UNEXPORTED_QUERY = text(
    "SELECT id, event_id, job_uuid, job_name, type, timestamp, logged_at, "
    "       lat, lng, accuracy_m, note, created_by "
    "FROM events e "
    "WHERE NOT EXISTS ("
    "    SELECT 1 FROM sheet_event_exports s WHERE s.event_id = e.event_id"
    ") "
    "ORDER BY e.id ASC "
    "LIMIT :limit"
)


def _iso_or_empty(dt: Any) -> str:
    if dt is None:
        return ""
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def find_unexported_events(db: Session, limit: int) -> List[Dict[str, Any]]:
    """Return up to `limit` events that exist in `events` but have no row in
    `sheet_event_exports`, shaped for `export_events_to_sheets`.

    Uses NOT EXISTS so the planner can use the `sheet_event_exports` primary
    key. Ordered by id ascending so consecutive runs naturally pick up where
    the last one left off.
    """
    if limit <= 0:
        return []

    rows = db.execute(_UNEXPORTED_QUERY, {"limit": limit}).mappings().all()

    out: List[Dict[str, Any]] = []
    for r in rows:
        # job_date isn't stored on the event row — the live sync path pulls
        # it from device localStorage. Reconciled rows carry "" so admins can
        # tell them apart in the sheet if they look. The remaining columns
        # are fully populated from the events row.
        out.append({
            "event_id":   r["event_id"],
            "timestamp":  _iso_or_empty(r["timestamp"]),
            "logged_at":  _iso_or_empty(r["logged_at"]),
            "job_uuid":   r["job_uuid"] or "",
            "job_name":   r["job_name"] or "",
            "job_date":   "",
            "type":       r["type"],
            "note":       r["note"],
            "lat":        r["lat"],
            "lng":        r["lng"],
            "accuracy_m": r["accuracy_m"],
            "device_id":  "reconciler",
            "created_by": r["created_by"] or "",
        })
    return out


def reconcile_events(
    db: Session,
    *,
    batch_size: int = 200,
    max_events: int = 2000,
    sleep_between_batches_s: float = 0.5,
) -> Dict[str, int]:
    """Find events missing from the sheet and ship them, in bounded batches.

    Memory shape: at most `batch_size` event dicts in scope at once. Between
    batches we sleep briefly so a large backlog can't monopolize a Render
    worker (the bounded export pool helps the live path; this helps the
    reconciler stay polite when run on the API process).

    Returns counts; never raises. Caller can surface `errors > 0` in the UI.
    """
    found = 0
    exported = 0
    errors = 0
    started = _time.monotonic()

    while exported + errors < max_events:
        remaining = max_events - exported - errors
        take = min(batch_size, remaining)
        batch = find_unexported_events(db, take)
        if not batch:
            break
        found += len(batch)

        try:
            n = export_events_to_sheets(db, batch)
            exported += n
            # `n < len(batch)` here means some events were already in the
            # dedupe table when the exporter re-checked — a benign race
            # with a parallel /api/sync. Not an error.
        except Exception:
            # Don't blow up the whole reconciliation on one bad batch — the
            # next run picks them up. Roll back so the session stays usable.
            try:
                db.rollback()
            except Exception:
                pass
            errors += len(batch)

        if sleep_between_batches_s > 0 and exported + errors < max_events:
            _time.sleep(sleep_between_batches_s)

    return {
        "found": found,
        "exported": exported,
        "errors": errors,
        "duration_ms": int((_time.monotonic() - started) * 1000),
    }


def count_unexported_events(db: Session) -> int:
    """Cheap count of how many events are missing from the sheet. Used by
    the App Health checker so the admin can see drift without running a
    full reconcile."""
    row = db.execute(
        text(
            "SELECT COUNT(*) FROM events e "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sheet_event_exports s WHERE s.event_id = e.event_id"
            ")"
        )
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else 0
