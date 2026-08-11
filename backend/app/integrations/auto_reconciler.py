"""
Background auto-reconciler for Postgres → Sheets drift.

The /api/sync path (and every other write path) inserts into Postgres
synchronously and fires the Sheets export on a background thread (see
run_export_in_background). That thread can die before completing - worker
recycling via `--limit-max-requests`, OOM kill, a mid-flight network drop past
the _ssl_retry budget, or a sustained quota 429 - leaving the row in Postgres
but not in the sheet. Admin used to recover by clicking the Refresh button in
Settings; this module makes that automatic.

Three sweeps run here:
- events, via `reconcile_events` (marker table `sheet_event_exports`)
- signed BOLs, via `reconcile_bols` (marker table)
- every other sync (materials, reports, RODS, reimbursements, ...), via
  `reconcile_all_missing` - a DB-vs-sheet diff that re-drives whatever never
  landed. These fired once at write time and, if that died, were stranded until
  a human re-saved the record; this closes that hole. It is the heaviest sweep
  (a full diff, not a marker lookup), so it runs on a slower cadence.

Design:
- One daemon thread per worker process, started from on_startup.
- Fires every RECONCILE_INTERVAL_S; sleeps that long *first* so we don't
  pile work onto a cold worker still loading state.
- Postgres advisory lock (pg_try_advisory_lock) means only one worker
  at a time runs reconciliation, even when Render scales out. Other
  workers skip silently.
- Bounded batch (BATCH_SIZE / MAX_EVENTS) so a huge backlog can't pin
  the worker for an unbounded time.
- All exceptions are caught and logged; the loop never dies.
"""

from __future__ import annotations

import threading
import time
from typing import Optional

# Advisory-lock key - arbitrary 32-bit integer, picked once and kept
# stable. If multiple subsystems start using pg_advisory_lock, give each
# its own key from app.integrations._advisory_locks (not built yet - for
# now, a magic number is fine, with this comment as the documentation).
_ADVISORY_LOCK_KEY = 0x7C8E0001

# Tuning. Off the request path, so we err on the side of "small bites,
# often" rather than "big bites, rarely" - keeps memory low.
RECONCILE_INTERVAL_S = 300   # 5 minutes
BATCH_SIZE = 100
MAX_EVENTS_PER_CYCLE = 500
# BOLs are far lower-volume than events (one per long-distance job), so a small
# per-cycle cap is plenty and keeps the Sheets calls modest.
BOL_BATCH_SIZE = 50
BOL_MAX_PER_CYCLE = 200
ON_ERROR_BACKOFF_S = 60

# Generic self-heal for the other 17 sheet syncs (materials, reports, RODS,
# reimbursements, ...). Events and BOLs have their own marker-table reconcilers
# above; everything else fired once at write time and, if it died, was stranded
# until a human re-saved the record. This runs the backfill audit (DB vs sheet)
# and re-drives what never landed. It is a full DB-vs-sheet diff, heavier than
# the marker-table sweeps, so it runs on a slower cadence: every Nth cycle
# (~20 min at the 5-min base interval), not every cycle.
GENERIC_RECONCILE_EVERY_N_CYCLES = 4
_cycle_count = 0

_started = False
_started_lock = threading.Lock()


def start_auto_reconciler() -> None:
    """Start the daemon thread. Idempotent - safe to call multiple times.
    No-op if the loop is already running in this process."""
    global _started
    with _started_lock:
        if _started:
            return
        _started = True
    t = threading.Thread(target=_loop, daemon=True, name="auto-reconciler")
    t.start()


def _try_acquire_advisory_lock(db) -> bool:
    """Try to acquire the cross-worker advisory lock. Returns True if we
    got it (we should reconcile) or False (another worker is doing it,
    skip this cycle).

    Released automatically when this DB session closes.
    """
    from sqlalchemy import text
    try:
        row = db.execute(
            text("SELECT pg_try_advisory_lock(:k)"),
            {"k": _ADVISORY_LOCK_KEY},
        ).scalar()
        return bool(row)
    except Exception as exc:
        # If the lock query itself fails (DB blip), don't run reconcile -
        # the next cycle will retry.
        print(f"[auto-reconcile] advisory-lock check failed: {exc}")
        return False


def _run_once() -> None:
    from app.db.session import SessionLocal
    from app.integrations.sheets_reconcile import reconcile_events
    from app.integrations.bol_reconcile import reconcile_bols

    db = SessionLocal()
    try:
        if not _try_acquire_advisory_lock(db):
            return
        result = reconcile_events(
            db,
            batch_size=BATCH_SIZE,
            max_events=MAX_EVENTS_PER_CYCLE,
        )
        # Only log when we actually moved data - silent otherwise so the
        # log isn't noisy in steady state.
        if result.get("found", 0) > 0 or result.get("errors", 0) > 0:
            print(
                f"[auto-reconcile] {result.get('exported', 0)} exported, "
                f"{result.get('errors', 0)} errors, "
                f"{result.get('duration_ms', 0)} ms"
            )

        # Same durability sweep for signed BOLs: a scheduled export whose pool
        # thread died leaves the BOL in Postgres but not the sheet (ADR 0020).
        bol_result = reconcile_bols(db, batch_size=BOL_BATCH_SIZE, max_bols=BOL_MAX_PER_CYCLE)
        if bol_result.get("found", 0) > 0 or bol_result.get("errors", 0) > 0:
            print(
                f"[auto-reconcile] bols: {bol_result.get('exported', 0)} exported, "
                f"{bol_result.get('errors', 0)} errors, "
                f"{bol_result.get('duration_ms', 0)} ms"
            )

        # Generic self-heal for the remaining 17 syncs, on a slower cadence.
        # Runs inside the same advisory lock, so only one worker sweeps.
        global _cycle_count
        _cycle_count += 1
        if _cycle_count % GENERIC_RECONCILE_EVERY_N_CYCLES == 0:
            from app.integrations.sheet_backfill import reconcile_all_missing
            gen = reconcile_all_missing(db)
            if gen.get("queued", 0) or gen.get("remaining_missing", 0) or not gen.get("ok", True):
                msg = (
                    f"[auto-reconcile] generic: {gen.get('queued', 0)} re-driven "
                    f"{gen.get('per_sync') or {}}, "
                    f"{gen.get('remaining_missing', 0)} still missing"
                )
                if gen.get("error"):
                    msg += f", error={gen['error']}"
                print(msg)
    finally:
        try:
            db.close()
        except Exception:
            pass


def _loop() -> None:
    print(f"[auto-reconcile] starting (interval {RECONCILE_INTERVAL_S}s)")
    while True:
        # Sleep FIRST - gives a cold worker its boot window before we
        # start pulling on the Sheets API.
        try:
            time.sleep(RECONCILE_INTERVAL_S)
        except Exception:
            return
        try:
            _run_once()
        except Exception as exc:
            print(f"[auto-reconcile] cycle failed: {exc}")
            try:
                time.sleep(ON_ERROR_BACKOFF_S)
            except Exception:
                return
