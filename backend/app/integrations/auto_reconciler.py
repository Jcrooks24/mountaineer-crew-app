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
- A row-based lease (worker_leases) means only one worker
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

# One lease row per background job. A second sweep would use its own name.
_LEASE_NAME = "auto_reconcile"

# How long a claim is held. Must comfortably exceed a slow cycle, or a worker
# still sweeping would have its lease expire and a second worker would join it -
# the exact concurrency this prevents. It must also not be so long that a killed
# worker blocks reconciliation for ages, since the clock is what releases it.
# Cycles are minutes at worst against a 5-minute interval, so 15 minutes leaves
# room without stalling recovery.
LEASE_TTL_S = 900


def _holder() -> str:
    """Diagnostic only, never used for correctness - which worker is sweeping."""
    import os
    import socket
    try:
        return f"{socket.gethostname()}:{os.getpid()}"
    except Exception:
        return "unknown"

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


def _try_claim_lease(db) -> bool:
    """Claim the cross-worker lease. True if this worker should sweep.

    This replaced `pg_try_advisory_lock`, which is SESSION-scoped and so only
    guarantees single-flight while the whole cycle runs on one backend
    connection. Staging connects through a TRANSACTION-mode pooler, and the
    cycle commits partway through (export_events_to_sheets writes its dedupe
    markers and commits), after which the session may be served by a different
    backend - so from that point the lock protected nothing. Production is a
    direct Render Postgres where the lock did behave, which is exactly why the
    difference went unnoticed: staging and prod had different semantics for the
    same code. See app/db/models/worker_lease.py.

    CORRECTNESS RESTS ON ONE ATOMIC STATEMENT. The UPDATE claims the row only if
    the current lease has expired, and Postgres serialises concurrent UPDATEs of
    the same row - so of two workers racing, exactly one sees a row updated.
    Reading the row and then writing it would reintroduce the race this exists to
    remove.

    `now()` and the expiry are both the DATABASE's clock. Two workers with skewed
    clocks would otherwise disagree about who holds the lease.
    """
    from sqlalchemy import text
    try:
        # INSERT first so the row exists; ON CONFLICT DO NOTHING makes the race
        # between two workers creating it harmless.
        db.execute(
            text(
                "INSERT INTO worker_leases (name, holder, expires_at, updated_at) "
                "VALUES (:n, :h, now(), now()) ON CONFLICT (name) DO NOTHING"
            ),
            {"n": _LEASE_NAME, "h": _holder()},
        )
        got = db.execute(
            text(
                "UPDATE worker_leases "
                "SET holder = :h, "
                "    expires_at = now() + make_interval(secs => :ttl), "
                "    updated_at = now() "
                "WHERE name = :n AND expires_at <= now() "
                "RETURNING id"
            ),
            {"n": _LEASE_NAME, "h": _holder(), "ttl": float(LEASE_TTL_S)},
        ).first()
        db.commit()
        return got is not None
    except Exception as exc:
        # A DB blip must not run reconcile unprotected - skip and retry next
        # cycle. Roll back so the session is usable for the next attempt.
        try:
            db.rollback()
        except Exception:
            pass
        print(f"[auto-reconcile] lease claim failed: {exc}")
        return False


def _release_lease(db) -> None:
    """Expire our lease so the next cycle can start immediately.

    Best-effort. If it fails - or the worker is killed before reaching it - the
    lease simply times out on its own, which is the property an advisory lock did
    not have: a stranded lock is held until its backend dies, a stranded lease is
    held until the clock passes it.
    """
    from sqlalchemy import text
    try:
        db.execute(
            text("UPDATE worker_leases SET expires_at = now() WHERE name = :n AND holder = :h"),
            {"n": _LEASE_NAME, "h": _holder()},
        )
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass


def _run_once() -> None:
    from app.db.session import SessionLocal
    from app.integrations.sheets_reconcile import reconcile_events
    from app.integrations.bol_reconcile import reconcile_bols

    db = SessionLocal()
    try:
        if not _try_claim_lease(db):
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
        # Release before closing so the next cycle can start at once rather than
        # waiting out the TTL. If this never runs - the worker was killed - the
        # lease expires on the clock, which is the whole point of using one.
        try:
            _release_lease(db)
        except Exception:
            pass
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
