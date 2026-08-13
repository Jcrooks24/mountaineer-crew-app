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
# the marker-table sweeps, so it runs on a slower cadence: ~20 minutes.
#
# THE SCHEDULE LIVES IN POSTGRES, NOT IN THIS PROCESS. It used to be
# `_cycle_count % 4`, an in-memory counter reset to 0 on every worker start - and
# the worker is recycled every 1000 requests BY DESIGN (see the start command in
# CLAUDE.md; the flag is load-bearing and the recycles are routine, not failures).
# Four claimed cycles at five minutes each means the generic sweep needed the
# worker to survive 20+ uninterrupted minutes to run even once. On a busy
# afternoon - a single crew member opening one job costs ~20 requests - 1000
# requests can elapse well inside that window, so the counter restarted from zero
# every time and the sweep could go an entire working day without running. The
# more the crew used the app, the less the self-heal ran, which is exactly
# backwards, and it is silent: nothing logs a sweep that never happened.
#
# An unexpired lease row is now the "not yet due" state. It survives recycling,
# is shared across workers, and is keyed to the DATABASE clock.
GENERIC_RECONCILE_INTERVAL_S = 1200  # ~20 minutes, as before
_GENERIC_LEASE = "generic_reconcile"

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


def _try_claim_lease(db, name: str = _LEASE_NAME, ttl: float = None) -> bool:
    """Claim the cross-worker lease `name`. True if this worker should sweep.

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

    Two callers, using the same primitive for two different purposes:

      name=_LEASE_NAME       a mutual-exclusion lock, RELEASED when the cycle
                             ends so the next cycle can start at once.
      name=_GENERIC_LEASE    an INTERVAL TIMER, deliberately NOT released. The
                             unexpired lease *is* the "not yet due" state, so the
                             schedule lives in Postgres instead of in a process
                             that gets recycled. See its constant below.
    """
    from sqlalchemy import text
    ttl = float(LEASE_TTL_S if ttl is None else ttl)
    try:
        # INSERT first so the row exists; ON CONFLICT DO NOTHING makes the race
        # between two workers creating it harmless.
        db.execute(
            text(
                "INSERT INTO worker_leases (name, holder, expires_at, updated_at) "
                "VALUES (:n, :h, now(), now()) ON CONFLICT (name) DO NOTHING"
            ),
            {"n": name, "h": _holder()},
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
            {"n": name, "h": _holder(), "ttl": ttl},
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
        print(f"[auto-reconcile] lease claim failed ({name}): {exc}")
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
        # Runs inside the same lease, so only one worker sweeps. The claim below
        # is the interval timer AND the cross-worker guard: whoever claims it
        # owns the next 20 minutes, and it is deliberately never released.
        from app.integrations.sheet_backfill import (
            backfill_cooldown_remaining,
            reconcile_all_missing,
        )
        # Check the cooldown BEFORE claiming, so a sweep that would only skip
        # does not burn the 20-minute timer and push the real sweep out behind an
        # admin's manual drain. reconcile_all_missing checks it again itself -
        # that one is the guard, this one just avoids wasting the slot.
        if backfill_cooldown_remaining() == 0 and _try_claim_lease(
            db, _GENERIC_LEASE, GENERIC_RECONCILE_INTERVAL_S
        ):
            gen = reconcile_all_missing(db)
            backlog = gen.get("backlog")
            if gen.get("queued", 0) or backlog or not gen.get("ok", True):
                # "backlog before this sweep", not "still missing after it".
                # Nothing here can know whether the exports landed - they are
                # fire-and-forget into the pool, and the answer arrives with the
                # NEXT audit. The old wording claimed otherwise and read as a
                # standing failure even on cycles that worked.
                msg = (
                    f"[auto-reconcile] generic: {gen.get('queued', 0)} re-driven "
                    f"{gen.get('per_sync') or {}}, "
                    f"backlog before sweep {backlog if backlog is not None else 'n/a'}"
                )
                if gen.get("skipped_reason"):
                    msg += f", skipped: {gen['skipped_reason']}"
                if gen.get("error"):
                    msg += f", error={gen['error']}"
                # The reason a backlog is not draining, printed where the person
                # wondering about it is already looking.
                for f in (gen.get("failures") or [])[:3]:
                    msg += f"\n    last failure: {f.get('fn')}: {f.get('error')}"
                print(msg)
            else:
                # A LIVENESS LINE, and worth the ~72 lines a day it costs. The
                # sweep was previously silent when it had nothing to do, which is
                # indistinguishable in a log from the sweep never running at all -
                # and it WAS never running, for months, because its schedule sat
                # in a counter that every worker recycle reset. Silence that
                # cannot be told apart from absence is not quiet, it is blind.
                print("[auto-reconcile] generic: nothing missing")
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
