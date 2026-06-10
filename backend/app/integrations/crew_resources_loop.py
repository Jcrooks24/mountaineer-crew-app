"""
Hourly background loop that keeps the Crew Resources calendar event in
sync with availability + Jobs-calendar attendees.

Same shape as the auto-reconciler: daemon thread per worker, Postgres
advisory lock so only one worker actually runs the refresh each cycle,
all exceptions caught so the loop never dies.

Gated by CREW_RESOURCES_ENABLED=true so the feature stays inert until
admin has bumped the OAuth scope and pasted the new token via
/api/admin/cal-token.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Optional


# Distinct advisory-lock key from the auto-reconciler so the two loops
# don't block each other.
_ADVISORY_LOCK_KEY = 0x7C8E0002

REFRESH_INTERVAL_S = 3600          # 1 hour
HORIZON_DAYS = 14
ON_ERROR_BACKOFF_S = 300

_started = False
_started_lock = threading.Lock()


def _is_enabled() -> bool:
    return os.getenv("CREW_RESOURCES_ENABLED", "").strip().lower() == "true"


def start_crew_resources_loop() -> None:
    """Start the daemon thread if enabled. Safe to call repeatedly."""
    global _started
    if not _is_enabled():
        return
    with _started_lock:
        if _started:
            return
        _started = True
    t = threading.Thread(target=_loop, daemon=True, name="crew-resources-loop")
    t.start()


def _try_acquire_advisory_lock(db) -> bool:
    from sqlalchemy import text
    try:
        row = db.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": _ADVISORY_LOCK_KEY},
        ).scalar()
        return bool(row)
    except Exception as exc:
        print(f"[crew-resources] advisory-lock check failed: {exc}")
        return False


def _run_once() -> None:
    from app.db.session import SessionLocal
    from app.integrations.crew_resources_calendar import (
        update_crew_resources_for_horizon,
    )

    db = SessionLocal()
    try:
        if not _try_acquire_advisory_lock(db):
            return
        results = update_crew_resources_for_horizon(db, days_ahead=HORIZON_DAYS)
        ok = sum(1 for r in results if r.get("ok"))
        failed = [r for r in results if not r.get("ok")]
        if failed:
            print(f"[crew-resources] {ok} updated, {len(failed)} failed: {failed[:3]}")
        else:
            print(f"[crew-resources] {ok} events refreshed")
    finally:
        try:
            db.close()
        except Exception:
            pass


def _loop() -> None:
    print(
        f"[crew-resources] starting (interval {REFRESH_INTERVAL_S}s, "
        f"horizon {HORIZON_DAYS} days)"
    )
    # Run once on startup so admin can verify wiring without waiting an hour.
    try:
        _run_once()
    except Exception as exc:
        print(f"[crew-resources] startup run failed: {exc}")

    while True:
        try:
            time.sleep(REFRESH_INTERVAL_S)
        except Exception:
            return
        try:
            _run_once()
        except Exception as exc:
            print(f"[crew-resources] cycle failed: {exc}")
            try:
                time.sleep(ON_ERROR_BACKOFF_S)
            except Exception:
                return
