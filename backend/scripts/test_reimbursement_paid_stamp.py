"""Finalizing payroll marks the reimbursements it paid (request b59434c2 item 2).
`python scripts/test_reimbursement_paid_stamp.py`

WHY THIS EXISTS. A reimbursement carried an approval state (submitted / approved
/ rejected) and no record of ever having been PAID. Payroll pays everything not
explicitly declined, so a claim could go out on a finalized run and still read
"submitted" forever. Nothing in the app could answer "has this been reimbursed
yet?", which is the first question both the crew member and the office ask.

The two properties that matter and are easy to get wrong:

  1. WHAT counts as paid. The same rows payroll counted - everything in the
     window except an explicit decline, INCLUDING claims still at "submitted",
     because pay-unless-declined means an unreviewed claim was still money that
     went out. Marking only "approved" ones would under-record.
  2. IDEMPOTENCE. Re-finalizing a period is normal (the admin does it whenever
     one more correction turns up). A second run must not move the payment date
     of anything already stamped, or re-attribute a claim to the wrong run.

Runs against in-memory SQLite. No network, no credentials, no Postgres.
"""

import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.models.reimbursement import Reimbursement  # noqa: E402
from app.db.models.user import User  # noqa: E402
from app.routers.payroll import _mark_reimbursements_paid  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


engine = create_engine("sqlite://")
# Only the two tables this needs. Base.metadata.create_all would try to build
# every model the payroll import chain touches, and fails on a foreign key into
# a table whose module is not imported here - a problem about the test harness,
# not about anything under test.
User.__table__.create(engine)
Reimbursement.__table__.create(engine)
db = sessionmaker(bind=engine)()

START, END = date(2026, 9, 1), date(2026, 9, 14)

user = User(id=1, email="a@b.c", password_hash="x", name="A", role="user", is_active=True)
db.add(user)
db.commit()
roster = {1: user}

seq = [0]


def claim(status="submitted", expense_date="2026-09-05", user_id=1, amount=25.0):
    seq[0] += 1
    r = Reimbursement(
        reimbursement_uuid=f"r{seq[0]}",
        user_id=user_id,
        user_name="A",
        type="expense",
        payment_method="personal",
        amount=amount,
        expense_date=expense_date,
        status=status,
        created_at=datetime(2026, 9, 5, 12, 0, 0),
        updated_at=datetime(2026, 9, 5, 12, 0, 0),
    )
    db.add(r)
    db.commit()
    return r


print("What counts as paid:")
submitted = claim("submitted")
approved = claim("approved")
rejected = claim("rejected")
n = _mark_reimbursements_paid(db, START, END, roster)
db.commit()
check("an approved claim is marked paid", approved.paid_at is not None)
check("an UNREVIEWED claim is marked paid too (payroll pays unless declined)",
      submitted.paid_at is not None)
check("a declined claim is NOT marked paid", rejected.paid_at is None)
check("the count reports only what it stamped", n == 2, str(n))

print("\nIt records which run paid it:")
check("the period start is stamped", approved.paid_period_start == "2026-09-01",
      str(approved.paid_period_start))
check("the period end is stamped", approved.paid_period_end == "2026-09-14",
      str(approved.paid_period_end))

print("\nOut of the window, or nobody's claim:")
before = claim("approved", expense_date="2026-08-31")
after = claim("approved", expense_date="2026-09-15")
orphan = claim("approved", user_id=999)
n2 = _mark_reimbursements_paid(db, START, END, roster)
db.commit()
check("a claim before the period is untouched", before.paid_at is None)
check("a claim after the period is untouched", after.paid_at is None)
check("a claim for somebody not on the roster is untouched", orphan.paid_at is None)
check("and none of them were counted", n2 == 0, str(n2))

print("\nIDEMPOTENCE: re-finalizing must not move anything:")
first_stamp = approved.paid_at
first_period = approved.paid_period_start
n3 = _mark_reimbursements_paid(db, START, END, roster)
db.commit()
check("a second run stamps nothing", n3 == 0, str(n3))
check("and does not move the payment date", approved.paid_at == first_stamp)

# The trap: a claim paid on an EARLIER run must keep that run's dates, not be
# re-attributed to whichever period is finalized next.
LATER_START, LATER_END = date(2026, 9, 15), date(2026, 9, 28)
n4 = _mark_reimbursements_paid(db, LATER_START, LATER_END, roster)
db.commit()
check("finalizing a LATER period does not re-attribute an already-paid claim",
      approved.paid_period_start == first_period, str(approved.paid_period_start))
check("but it does pay the claim that falls in that later window",
      after.paid_at is not None and after.paid_period_start == "2026-09-15",
      str(after.paid_period_start))
check("and counts exactly that one", n4 == 1, str(n4))

print("\nA declined claim later approved is paid by the NEXT run, not retroactively:")
rejected.status = "approved"
db.commit()
n5 = _mark_reimbursements_paid(db, START, END, roster)
db.commit()
check("it is picked up once it is no longer declined", rejected.paid_at is not None)
check("and stamped with the run that actually paid it", n5 == 1, str(n5))

print("\nApproval and payment stay separate facts:")
check("paying does not overwrite the approval status",
      approved.status == "approved" and submitted.status == "submitted",
      f"{approved.status} / {submitted.status}")

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
