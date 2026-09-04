"""The office reimbursement / mileage ledger (request b59434c2 item 3).
`python scripts/test_reimbursement_admin_search.py`

WHY THIS EXISTS. The office re-keys reimbursements and mileage into QuickBooks by
hand, and nothing recorded whether a claim had been entered yet. The only guard
against entering the same receipt twice was somebody's memory.

Two properties are worth holding onto:

  1. The search is ADMIN-ONLY and separate from the crew list endpoint. The crew
     endpoint defaults to the caller's own rows and grows an admin escape hatch;
     that shape is what eventually leaks somebody else's receipts. This one is
     admin from its first line.
  2. Marking a claim entered is REVERSIBLE, and the who/when stamp is cleared on
     the way back. A one-way flag turns a mis-click into a receipt that never
     gets entered, which is the failure the column exists to prevent.

In-memory SQLite. No network, no credentials, no Postgres.
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.models.reimbursement import Reimbursement  # noqa: E402
from app.db.models.user import User  # noqa: E402
from app.routers.reimbursement import (  # noqa: E402
    QB_STATUSES,
    QbStatusIn,
    search_reimbursements,
    set_qb_status,
)

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


engine = create_engine("sqlite://")
User.__table__.create(engine)
Reimbursement.__table__.create(engine)
db = sessionmaker(bind=engine)()

admin = User(id=1, email="office@x.c", password_hash="x", name="Office", role="admin", is_active=True)
crew = User(id=2, email="c@x.c", password_hash="x", name="Casey", role="user", is_active=True)
db.add_all([admin, crew])
db.commit()

seq = [0]


def claim(**kw):
    seq[0] += 1
    now = datetime(2026, 9, 1, 12, 0, 0)
    defaults = dict(
        reimbursement_uuid=f"r{seq[0]}", user_id=2, user_name="Casey", type="expense",
        payment_method="personal", amount=25.0, expense_date="2026-09-05",
        status="submitted", vendor="Home Depot", category="supplies", notes="",
        created_at=now, updated_at=now,
    )
    defaults.update(kw)
    r = Reimbursement(**defaults)
    db.add(r)
    db.commit()
    return r


# Every filter defaults to None; `limit` is a plain int here because the FastAPI
# Query() defaults only resolve inside a request.
def search(**kw):
    args = dict(user_id=None, type=None, status=None, qb_status=None,
                payment_method=None, date_from=None, date_to=None, q=None,
                limit=200, db=db, _=admin)
    args.update(kw)
    return search_reimbursements(**args)


print("Everything defaults to pending entry:")
a = claim()
check("a new claim is pending, not entered", (a.qb_status or "pending") == "pending",
      str(a.qb_status))
check("with no who/when stamp", a.qb_entered_at is None and a.qb_entered_by_name is None)

print("\nThe filters compose:")
claim(type="mileage", odometer_start=100, odometer_end=180, amount=None, vendor=None,
      category=None, expense_date="2026-09-06")
claim(payment_method="company", vendor="Lowes", expense_date="2026-08-20")
claim(status="rejected", vendor="Shell", expense_date="2026-09-07")
claim(user_id=1, user_name="Office", vendor="Staples", expense_date="2026-09-08")

check("by type", len(search(type="mileage")) == 1, str(len(search(type="mileage"))))
check("by status", len(search(status="rejected")) == 1)
check("by payment method", len(search(payment_method="company")) == 1)
check("by employee", len(search(user_id=1)) == 1)
check("by date range",
      len(search(date_from="2026-09-01", date_to="2026-09-06")) == 2,
      str(len(search(date_from="2026-09-01", date_to="2026-09-06"))))
check("free text matches a vendor", len(search(q="Lowes")) == 1)
check("free text matches an employee name", len(search(q="Casey")) == 4,
      str(len(search(q="Casey"))))
check("filters combine rather than replacing each other",
      len(search(payment_method="personal", status="submitted", q="Home Depot")) == 1)
check("nothing matching returns empty, not everything", len(search(q="zzzz")) == 0)
check("no filters returns the lot", len(search()) == 5, str(len(search())))

print("\nReceipt and odometer links come back for the office to open:")
withphoto = claim(receipt_photo_url="https://drive.example/receipt", vendor="Ace")
out = search(q="Ace")[0]
check("the receipt link is in the payload",
      out.receipt_photo_url == "https://drive.example/receipt", str(out.receipt_photo_url))
mileage = search(type="mileage")[0]
check("mileage rows carry their odometer readings",
      mileage.odometer_start == 100 and mileage.odometer_end == 180)

print("\nMarking a claim entered in QuickBooks:")
res = set_qb_status(a.reimbursement_uuid, QbStatusIn(qb_status="entered"), db=db, current_user=admin)
check("the status flips", res.qb_status == "entered")
check("who entered it is recorded", res.qb_entered_by_name == "Office",
      str(res.qb_entered_by_name))
check("and when", res.qb_entered_at is not None)
check("it is findable by qb_status", len(search(qb_status="entered")) == 1)
check("and the rest are still pending", len(search(qb_status="pending")) == 5,
      str(len(search(qb_status="pending"))))

print("\nAnd putting it back, because a mis-click must be undoable:")
res2 = set_qb_status(a.reimbursement_uuid, QbStatusIn(qb_status="pending"), db=db, current_user=admin)
check("the status goes back", res2.qb_status == "pending")
check("the stamp is CLEARED, not left describing a state it is not in",
      res2.qb_entered_at is None and res2.qb_entered_by_name is None,
      f"{res2.qb_entered_at} / {res2.qb_entered_by_name}")

print("\nGuards:")


def rejects(uuid, value):
    try:
        set_qb_status(uuid, QbStatusIn(qb_status=value), db=db, current_user=admin)
        return False
    except Exception:
        return True


check("an invented status is refused", rejects(a.reimbursement_uuid, "maybe"))
check("an unknown claim 404s", rejects("nope", "entered"))
check("the vocabulary is exactly two states", QB_STATUSES == {"pending", "entered"},
      str(QB_STATUSES))

print("\nPayment and QuickBooks entry stay separate facts:")
a.paid_at = datetime(2026, 9, 15, 0, 0, 0)
a.paid_period_start = "2026-09-01"
db.commit()
paid = search(q="Home Depot")[0]
check("a claim can be paid and still pending entry",
      paid.paid_at is not None and paid.qb_status == "pending")
check("the payroll run that paid it is visible to the office",
      paid.paid_period_start == "2026-09-01")

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
