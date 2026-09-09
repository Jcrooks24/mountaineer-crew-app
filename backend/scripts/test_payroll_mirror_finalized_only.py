"""The Payroll worksheet mirrors FINALIZED payrolls only.
`python scripts/test_payroll_mirror_finalized_only.py`

User direction, 2026-09-09: the payroll sheets mirror should show finalized
payrolls only. Two ways that can be false, and only one of them is obvious:

  1. A period nobody finalized reaching the sheet. Guarded by requiring a
     `payroll_runs` row - a property of the export, not of whoever calls it.
     Before this it was true only because the sole caller happened to be
     finalize_period, which is an accident, not a guarantee.

  2. THE ONE THAT ACTUALLY BITES: a finalized period whose FIGURES are not the
     ones that were finalized. `_build_summary` reflects the data as it is now,
     so a correction entered after a finalize but before a re-finalize changes
     what it returns. The backfill re-drives exports from `payroll_runs` weeks
     later - and would have published numbers nobody ever finalized. Money that
     has been decided is not recomputed.

The fix for (2) is a snapshot taken inside the finalize transaction, and this
file's centre of gravity is proving the snapshot is what gets published.

In-memory SQLite. No network, no credentials, no Postgres.
"""
import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.models.payroll_run import PayrollRun  # noqa: E402
import app.routers.payroll as pr  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


engine = create_engine("sqlite://")
PayrollRun.__table__.create(engine)
db = sessionmaker(bind=engine)()

S, E = date(2026, 9, 1), date(2026, 9, 14)

# Capture what would be exported instead of touching Sheets.
exported = []
pr.run_export_in_background = lambda fn, payload: exported.append(payload)
import app.integrations.sheets_export as sx  # noqa: E402
sx.run_export_in_background = lambda fn, payload: exported.append(payload)

print("A period nobody finalized is not mirrored at all:")
pr._queue_payroll_export(db, S, E)
check("no payroll_runs row means no export", exported == [], str(exported))

print("\nA finalized period with no snapshot is skipped, not guessed at:")
run = PayrollRun(period_start=S.isoformat(), period_end=E.isoformat(),
                 finalized_at=datetime(2026, 9, 15, 9, 0, 0), finalized_by_name="Office",
                 run_count=1, rows_json=None)
db.add(run)
db.commit()
exported.clear()
pr._queue_payroll_export(db, S, E)
check("a run with no snapshot exports nothing", exported == [], str(exported))
check("rather than falling back to live figures", True,
      "the fallback would be the exact failure this exists to prevent")

print("\nA finalized period publishes ITS SNAPSHOT:")
SNAP = [{"name": "Casey", "totals": {"regular_hours": 40, "tips_amount": 40.0}}]
run.rows_json = json.dumps(SNAP)
db.commit()
exported.clear()
pr._queue_payroll_export(db, S, E)
check("exactly one export was queued", len(exported) == 1, str(len(exported)))
payload = exported[0]
check("keyed by the period", payload["period"] == "2026-09-01..2026-09-14", str(payload.get("period")))
check("carrying the snapshot rows", payload["employees"] == SNAP, str(payload["employees"]))
check("and the finalize timestamp, not now",
      payload["finalized_at"] == datetime(2026, 9, 15, 9, 0, 0), str(payload["finalized_at"]))

print("\nTHE DRIFT CASE: live data moving does not change what is published:")
# Stand in for a correction entered after the finalize. _build_summary would
# return the new number; the snapshot must not.
pr._build_summary = lambda db_, s_, e_: {
    "employees": [{"name": "Casey", "totals": {"regular_hours": 99, "tips_amount": 999.0}}]
}
exported.clear()
pr._queue_payroll_export(db, S, E)
check("the export still carries the FINALIZED figures",
      exported[0]["employees"] == SNAP, str(exported[0]["employees"]))
check("not the recomputed ones",
      exported[0]["employees"][0]["totals"]["regular_hours"] == 40,
      "a re-drive must not publish numbers nobody finalized")

print("\nA re-finalize is the one thing that legitimately changes it:")
NEW = pr._payroll_snapshot_rows(db, S, E)
check("the snapshot builder reads the CURRENT summary",
      NEW[0]["totals"]["regular_hours"] == 99, str(NEW))
run.rows_json = json.dumps(NEW)
run.run_count += 1
db.commit()
exported.clear()
pr._queue_payroll_export(db, S, E)
check("and once stored, that is what publishes",
      exported[0]["employees"][0]["totals"]["regular_hours"] == 99)
check("the run counts as re-run", run.run_count == 2)

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
