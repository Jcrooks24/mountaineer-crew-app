"""Verify the generic self-heal sweep is scheduled in Postgres, not in process memory.

    python backend/scripts/verify_generic_sweep_schedule.py

Runs against a fake in-memory "database" that mimics the one atomic UPDATE the
lease relies on, so it needs no Postgres and no Sheets access.

WHAT IT GUARDS. The sweep's cadence used to be `_cycle_count % 4`, a module
global. The web worker is recycled every 1000 requests BY DESIGN (the
`--limit-max-requests` flag in the start command is load-bearing, and the
recycles are routine, not failures). Every recycle reset that counter to zero, so
the sweep needed the worker to survive 20+ uninterrupted minutes to run even
once. A single crew member opening one job costs ~20 requests, so on a busy
afternoon 1000 requests elapse well inside that window - meaning the more the
crew used the app, the less the self-heal ran. Exactly backwards, and silent:
nothing logs a sweep that never happened.

The schedule now lives in a `worker_leases` row. The regression is subtle - move
the interval back into a global, or start releasing the generic lease, and the
sweep quietly stops running again with no error anywhere.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


class FakeDB:
    """Just enough Postgres: rows keyed by lease name, and an UPDATE that only
    claims when the lease has expired. `now` is explicit so the test can move
    time without sleeping."""

    def __init__(self):
        self.rows = {}
        self.now = 1000.0
        self.claims = []

    def execute(self, stmt, params):
        sql = str(stmt)
        name = params["n"]
        if "INSERT INTO worker_leases" in sql:
            self.rows.setdefault(name, {"holder": params["h"], "expires_at": self.now})
            return _Result(None)
        if "UPDATE worker_leases" in sql and "expires_at <= now()" in sql:
            row = self.rows.get(name)
            if row is not None and row["expires_at"] <= self.now:
                row["holder"] = params["h"]
                row["expires_at"] = self.now + params["ttl"]
                self.claims.append((name, self.now))
                return _Result((1,))
            return _Result(None)
        if "SET expires_at = now()" in sql:  # release
            row = self.rows.get(name)
            if row is not None and row["holder"] == params["h"]:
                row["expires_at"] = self.now
            return _Result(None)
        raise AssertionError(f"unexpected SQL: {sql[:80]}")

    def commit(self):
        pass

    def rollback(self):
        pass


class _Result:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


import app.integrations.auto_reconciler as ar  # noqa: E402

GEN = ar._GENERIC_LEASE
IVL = ar.GENERIC_RECONCILE_INTERVAL_S

print("The generic sweep is due on an interval, not a cycle count:")
db = FakeDB()
check("first claim succeeds immediately after deploy",
      ar._try_claim_lease(db, GEN, IVL) is True)
check("a second claim right away is refused",
      ar._try_claim_lease(db, GEN, IVL) is False)
db.now += IVL - 1
check("still refused one second early", ar._try_claim_lease(db, GEN, IVL) is False)
db.now += 2
check("due once the interval has passed", ar._try_claim_lease(db, GEN, IVL) is True)

print("\nThe schedule survives a worker recycle (the actual bug):")
# Simulate the recycle the old code could not survive: the process dies and every
# module global is reinitialised. The lease row is in the database, so it stays.
db2 = FakeDB()
ar._try_claim_lease(db2, GEN, IVL)          # worker A sweeps
db2.now += 300                               # 5 minutes later...
for recycle in range(6):                     # ...worker recycled repeatedly
    claimed = ar._try_claim_lease(db2, GEN, IVL)
    if claimed:
        break
    db2.now += 60
check("a freshly started worker does not re-run the sweep early", not claimed,
      "a recycled worker restarted the clock" if claimed else "")
db2.now += IVL
check("and it does run once genuinely due", ar._try_claim_lease(db2, GEN, IVL) is True)

print("\nThe two leases do not interfere:")
db3 = FakeDB()
check("mutual-exclusion lease claims", ar._try_claim_lease(db3, ar._LEASE_NAME) is True)
check("interval lease claims independently", ar._try_claim_lease(db3, GEN, IVL) is True)
ar._release_lease(db3)  # end of cycle
check("releasing the cycle lease frees it",
      ar._try_claim_lease(db3, ar._LEASE_NAME) is True)
check("but does NOT free the interval timer - that is the schedule",
      ar._try_claim_lease(db3, GEN, IVL) is False)

print("\nThe interval is still the documented ~20 minutes:")
check("interval is 20 minutes", IVL == 1200, f"{IVL}s")
check("longer than the base cycle so it is a real slowdown",
      IVL > ar.RECONCILE_INTERVAL_S)
check("shorter than the lease TTL cannot strand it", ar.LEASE_TTL_S <= IVL + 300)

print("\nA DB failure is not silently treated as 'due':")
class BoomDB(FakeDB):
    def execute(self, stmt, params):
        raise RuntimeError("connection reset")
check("claim returns False when the database is unreachable",
      ar._try_claim_lease(BoomDB(), GEN, IVL) is False)

print("\nThe old in-process counter is gone:")
check("no _cycle_count global", not hasattr(ar, "_cycle_count"))
check("no every-N-cycles constant", not hasattr(ar, "GENERIC_RECONCILE_EVERY_N_CYCLES"))

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
