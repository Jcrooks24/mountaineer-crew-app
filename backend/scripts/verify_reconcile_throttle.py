"""Verify that the auto-reconcile sweep respects the cooldown it sets.

    python backend/scripts/verify_reconcile_throttle.py

No pytest in this repo, so this runs on bare python and exits non-zero on
failure. It stubs the audit rather than touching Sheets or Postgres, so it is
safe to run anywhere, any time.

WHAT IT GUARDS. Until 2026-08-13 the cooldown was enforced only on the two manual
admin endpoints, while the unattended sweep - the one that runs every 20 minutes
forever - both ignored it and pushed its deadline forward. That produced a
self-sustaining failure: the sweep queued 100 re-exports (~400 reads against a
60/minute quota), the pool went into 429 backoff, the exports failed, the records
stayed missing, and the next sweep re-drove the same records. The backlog never
drained, live crew exports were starved behind it, and an admin pressing Backfill
got a 429 from a door the background loop had shut.

The regression is a one-line one: drop the cooldown check at the top of
reconcile_all_missing, or let the per-cycle budget creep back up.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.integrations.sheet_backfill as sb  # noqa: E402
from app.integrations import sheets_export  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


def stub_audit(results=None, calls=None):
    def _audit(db):
        if calls is not None:
            calls.append(1)
        return {"connected": True, "results": results or []}
    sb.audit_sheet_backfill = _audit


_real_audit = sb.audit_sheet_backfill

print("The sweep respects its own cooldown (the fix):")

calls = []
stub_audit(calls=calls)
sb.reset_backfill_throttle()
sb.note_backfill_queued(60)              # a batch just went out; door shut
check("cooldown is actually set", sb.backfill_cooldown_remaining() > 0)
res = sb.reconcile_all_missing(None)
check("throttled sweep queues nothing", res["queued"] == 0)
check("and says why", "draining" in (res.get("skipped_reason") or ""),
      repr(res.get("skipped_reason")))
# The audit is itself three Sheets reads. Running it every 20 minutes during a
# quota storm is part of the problem, not a harmless no-op.
check("throttled sweep does not even audit", calls == [], f"audited {len(calls)}x")
check("it is not an error", res["ok"] is True)

print("\nThe throttle is not a permanent off switch:")
calls = []
stub_audit(calls=calls)
sb.reset_backfill_throttle()
res = sb.reconcile_all_missing(None)
check("a clear cooldown lets the sweep run", calls == [1])
check("no skip reason when it ran", res.get("skipped_reason") is None)

print("\nThe per-cycle budget stays inside the read quota:")
reads = sb.RECONCILE_MAX_PER_CYCLE * sb.READS_PER_REEXPORT
check("one sweep costs under a minute of quota", reads <= sb.READS_PER_MINUTE,
      f"{reads} reads vs {sb.READS_PER_MINUTE}/min")
check("unattended budget stays under the manual tool's cap",
      sb.RECONCILE_MAX_PER_CYCLE < sb.MAX_REEXPORT_PER_REQUEST,
      f"{sb.RECONCILE_MAX_PER_CYCLE} vs {sb.MAX_REEXPORT_PER_REQUEST}")

print("\nThe backlog is reported as pre-sweep, not as a result:")
stub_audit([{"key": "bills", "missing_count": 3, "missing": [], "auto": False}])
sb.reset_backfill_throttle()
res = sb.reconcile_all_missing(None)
# `remaining_missing` was measured BEFORE the sweep re-drove anything, so when
# the budget covered the backlog the log read "40 re-driven, 40 still missing"
# every cycle - including cycles where all 40 landed. It was read as proof the
# backfill was broken.
check("backlog counted", res.get("backlog") == 3, repr(res.get("backlog")))
check("the misleading key is gone", "remaining_missing" not in res)

print("\nA stalled backlog explains itself:")
stub_audit()
sheets_export.clear_export_failures()
sheets_export.note_export_failure("export_bill_to_sheets", "429 quota exceeded")
sb.reset_backfill_throttle()
res = sb.reconcile_all_missing(None)
check("failures travel with the result", bool(res.get("failures")))
check("and name the cause", "429" in (res.get("failures") or [{}])[0].get("error", ""))

print("\nThe drain estimate matches the door the throttle shuts:")
# If the operator is told a different figure than the throttle enforces, one of
# the two is a lie and the person waiting cannot tell which.
for n in (1, 15, 40, 100):
    sb.reset_backfill_throttle()
    est = sb.estimate_drain_seconds(n)
    sb.note_backfill_queued(n)
    actual = sb.backfill_cooldown_remaining()
    check(f"{n} records: estimate {est}s matches cooldown {actual}s",
          abs(est - actual) <= 1)
check("zero records estimates zero", sb.estimate_drain_seconds(0) == 0)
check("negative is not negative time", sb.estimate_drain_seconds(-5) == 0)
check("estimate is capped like the cooldown",
      sb.estimate_drain_seconds(10_000) == sb.MAX_COOLDOWN_SECONDS)
sb.reset_backfill_throttle()

print("\nThe manual drain keeps its own budget:")
# reconcile_all_missing is shared with the unattended sweep. When the sweep's
# default was cut to 15, the admin endpoint inherited the cut and the button got
# six times weaker without anyone changing that endpoint.
import io  # noqa: E402
# Read the file rather than import it: importing the admin router drags in the
# whole FastAPI app and its env requirements, and this script must run anywhere.
_admin = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                      "app", "routers", "admin.py")
src = io.open(_admin, encoding="utf-8").read()
check("drain-all passes an explicit budget",
      "reconcile_all_missing(db, max_total=" in src,
      "endpoint would silently inherit the sweep's small default")
check("and that budget is the manual cap, not the sweep's",
      "max_total=MAX_REEXPORT_PER_REQUEST" in src)

print("\nError paths keep the same shape:")


def boom(db):
    raise RuntimeError("sheets down")


sb.audit_sheet_backfill = boom
sb.reset_backfill_throttle()
res = sb.reconcile_all_missing(None)
check("error reported", res["ok"] is False)
check("still shaped like a result", "backlog" in res and "remaining_missing" not in res)

sb.audit_sheet_backfill = _real_audit
sb.reset_backfill_throttle()

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
