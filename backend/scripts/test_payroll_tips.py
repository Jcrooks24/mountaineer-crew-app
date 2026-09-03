"""Tips in payroll (request f8e008cb, 2026-09-03).
`python scripts/test_payroll_tips.py`

WHY THIS EXISTS. Tips existed only as a line on the customer's BILL - money
charged. Nothing paid one out to a crew member, so the office tracked them
outside the app.

The property that drove the design, and the one worth testing:

    "tips sometimes come in long after the crew has completed a job"

A tip recorded today for a job that ran last month must be paid on the CURRENT
run. Dating it by the job would drop it into a period that has already been
finalized and paid, where it would either be missed or force the admin to reopen
a reconciled run. So `tip_date` is the payout date, `job_uuid` is reference only,
and the two are deliberately independent.

The other two: tips are flat dollars that never enter the hours buckets, and
somebody whose only entry in a period is a late tip must still appear on the
payroll page - otherwise the money is invisible.

In-memory SQLite. No network, no credentials, no Postgres.
"""

import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.models.employee_tip import EmployeeTip  # noqa: E402
from app.db.models.user import User  # noqa: E402
from app.routers.payroll import _employee_summary, _tips  # noqa: E402
from app.schemas.payroll import TipCreate  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


engine = create_engine("sqlite://")
User.__table__.create(engine)
EmployeeTip.__table__.create(engine)
db = sessionmaker(bind=engine)()

user = User(id=1, email="a@b.c", password_hash="x", name="A", role="user", is_active=True)
other = User(id=2, email="b@b.c", password_hash="x", name="B", role="user", is_active=True)
db.add_all([user, other])
db.commit()
roster = {1: user, 2: other}

START, END = date(2026, 9, 15), date(2026, 9, 28)
seq = [0]


def tip(user_id, amount, tip_date, job_uuid=None, job_name=None):
    seq[0] += 1
    now = datetime(2026, 9, 20, 12, 0, 0)
    t = EmployeeTip(
        tip_uuid=f"t{seq[0]}", job_uuid=job_uuid, job_name=job_name,
        user_id=user_id, user_name="A", tip_date=tip_date, amount=amount,
        note="", created_at=now, updated_at=now,
    )
    db.add(t)
    db.commit()
    return t


print("THE POINT: a late tip pays on the run it was recorded for")
# The job ran on 2026-08-03, in a period long since finalized. The tip is
# recorded on 2026-09-20 and must land in the 09-15..09-28 run.
late = tip(1, 40.00, "2026-09-20", job_uuid="job-from-august", job_name="August move")
got = _tips(db, START, END, roster)
check("a tip for an old job lands in the CURRENT period",
      round(got[1]["amount"], 2) == 40.00, str(got.get(1)))
check("and it still records which job it came from",
      got[1]["items"][0]["job_name"] == "August move")
check("the job's own period does not claim it",
      1 not in _tips(db, date(2026, 8, 1), date(2026, 8, 14), roster))

print("\nWindowing is on the payout date:")
tip(1, 10.00, "2026-09-14")   # day before
tip(1, 11.00, "2026-09-29")   # day after
inside = _tips(db, START, END, roster)
check("a tip the day before the period is excluded",
      round(inside[1]["amount"], 2) == 40.00, str(inside[1]["amount"]))
check("the boundary days themselves are included",
      round(_tips(db, date(2026, 9, 14), date(2026, 9, 29), roster)[1]["amount"], 2) == 61.00,
      str(_tips(db, date(2026, 9, 14), date(2026, 9, 29), roster)[1]["amount"]))

print("\nTips sum per employee, and do not leak across people:")
tip(1, 5.50, "2026-09-16")
tip(2, 7.25, "2026-09-16")
both = _tips(db, START, END, roster)
check("employee A totals 45.50", round(both[1]["amount"], 2) == 45.50, str(both[1]["amount"]))
check("employee B totals 7.25", round(both[2]["amount"], 2) == 7.25, str(both[2]["amount"]))
check("A has two items in this window", len(both[1]["items"]) == 2, str(len(both[1]["items"])))

print("\nSomebody not on the roster is ignored, not crashed on:")
tip(999, 99.00, "2026-09-16")
check("an orphan tip does not appear", 999 not in _tips(db, START, END, roster))

print("\nTips are money, not hours: they never touch the buckets or OT")
summary = _employee_summary(
    user, [], START, END, {}, {"mileage_rate": 0.0, "per_diem_rate": 0.0},
    both.get(1, {}),
)
# tips_amount sits under `totals`, beside the other money figures
# (per_diem_amount, reimbursement_amount, mileage_amount) rather than with the
# hours - which is the point.
totals = summary["totals"]
check("tips_amount is reported", totals["tips_amount"] == 45.50, str(totals["tips_amount"]))
check("with no hours, total_hours is still zero", totals["total_hours"] == 0,
      str(totals["total_hours"]))
check("regular hours are untouched by a tip", totals["regular_hours"] == 0)
check("OT hours are untouched by a tip", totals["ot_hours"] == 0)
check("it sits with the money, not the hours",
      {"per_diem_amount", "reimbursement_amount", "mileage_amount"} <= set(totals))
check("the individual tips are listed for the admin", len(summary["tip_items"]) == 2)

print("\nA tip-only employee must still appear on the page:")
# This is the late-tip case again, from the other side: no hours at all this
# period, money owed. Nothing else would put them on the payroll screen.
check("a summary can be built from tips alone",
      _employee_summary(user, [], START, END, {}, {}, {"amount": 12.0, "items": []})
      ["totals"]["tips_amount"] == 12.0)

print("\nThe input guard (flat, positive, sane):")
def rejects(**kw):
    try:
        TipCreate(user_id=1, **kw)
        return False
    except Exception:
        return True


check("a zero tip is rejected", rejects(amount=0))
check("a negative tip is rejected (that is a correction, not a tip)", rejects(amount=-25))
check("an implausible tip is rejected", rejects(amount=25000))
check("a normal tip is accepted", TipCreate(user_id=1, amount=40).amount == 40.0)
check("cents survive", TipCreate(user_id=1, amount=12.345).amount == 12.35,
      str(TipCreate(user_id=1, amount=12.345).amount))
check("a job is optional", TipCreate(user_id=1, amount=5).job_uuid is None)

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
