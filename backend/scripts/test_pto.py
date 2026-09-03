"""PTO eligibility and the annual cap (request 1a50fa5b, 2026-09-03).
`python scripts/test_pto.py`

THE RULES, as given by the office:
  - allowance is per person, set by hand on the roster, no accrual formula
  - per CALENDAR year, no roll-over
  - PTO does NOT count toward overtime
  - logging is refused when not eligible, or when the year's allowance is spent

THE CASE THAT IS EASY TO GET WRONG, and the reason this file exists: EDITING an
existing PTO entry. The offline queue re-submits the same entry_uuid to change an
entry, so a naive check counts the old value against the new one and refuses to
lower 8 hours to 4 - "you cannot use 4 hours, you have already used 8" - which is
both wrong and impossible for the crew member to understand or work around.

In-memory SQLite. No network, no credentials, no Postgres.
"""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.pto import (  # noqa: E402
    PTO_PAY_STRUCTURE,
    check_pto_allowed,
    pto_balance,
    pto_used_hours,
)
from app.db.models.off_job_entry import OffJobEntry  # noqa: E402
from app.db.models.user import User  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


engine = create_engine("sqlite://")
User.__table__.create(engine)
OffJobEntry.__table__.create(engine)
db = sessionmaker(bind=engine)()

eligible = User(id=1, email="a@b.c", password_hash="x", name="A", role="user",
                is_active=True, pto_hours_annual=40)
not_eligible = User(id=2, email="b@b.c", password_hash="x", name="B", role="user",
                    is_active=True, pto_hours_annual=0)
db.add_all([eligible, not_eligible])
db.commit()

seq = [0]


def log_pto(user_id, hours, work_date, structure=PTO_PAY_STRUCTURE, uuid=None):
    seq[0] += 1
    now = datetime(2026, 3, 1, 12, 0, 0)
    e = OffJobEntry(
        entry_uuid=uuid or f"e{seq[0]}", submitted_by_id=user_id, submitted_by_name="A",
        work_date=work_date, hours=hours, pay_structure=structure,
        notes="pto", created_at=now, updated_at=now,
    )
    db.add(e)
    db.commit()
    return e


print("Eligibility is the allowance being above zero:")
check("somebody with 40 hours is eligible", pto_balance(db, eligible, 2026)["eligible"])
check("somebody with 0 hours is not", not pto_balance(db, not_eligible, 2026)["eligible"])
check("and is told to ask the office",
      "ask the office" in (check_pto_allowed(db, not_eligible, "2026-03-02", 8) or ""))

print("\nThe balance draws down as PTO is logged:")
log_pto(1, 8, "2026-03-02")
b = pto_balance(db, eligible, 2026)
check("8 used", b["used_hours"] == 8, str(b["used_hours"]))
check("32 remaining of 40", b["remaining_hours"] == 32 and b["cap_hours"] == 40, str(b))
log_pto(1, 24, "2026-06-01")
check("32 used after a second entry", pto_used_hours(db, 1, 2026) == 32)

print("\nOnly PTO entries count against PTO:")
log_pto(1, 40, "2026-07-01", structure="regular")
log_pto(1, 40, "2026-07-02", structure="non_billable")
check("regular and non-billable off-job hours do not spend the allowance",
      pto_used_hours(db, 1, 2026) == 32, str(pto_used_hours(db, 1, 2026)))

print("\nThe cap is enforced, and the message says what is left:")
check("a request inside the remainder is allowed",
      check_pto_allowed(db, eligible, "2026-08-01", 8) is None)
why = check_pto_allowed(db, eligible, "2026-08-01", 8.25)
check("a request over the remainder is refused", why is not None)
check("and the refusal names the remaining hours", "8 of 40" in (why or ""), str(why))
check("exactly the remainder is allowed (not an off-by-one)",
      check_pto_allowed(db, eligible, "2026-08-01", 8) is None)

print("\nThe allowance is per CALENDAR year, with no roll-over:")
check("next year starts empty", pto_used_hours(db, 1, 2027) == 0)
check("and the full allowance is available again",
      pto_balance(db, eligible, 2027)["remaining_hours"] == 40)
log_pto(1, 8, "2025-12-31")
check("an entry in a previous year does not spend this year's",
      pto_used_hours(db, 1, 2026) == 32, str(pto_used_hours(db, 1, 2026)))
check("boundary: 1 Jan counts toward that year",
      (log_pto(1, 1, "2027-01-01") is not None) and pto_used_hours(db, 1, 2027) == 1)
check("boundary: 31 Dec counts toward that year", pto_used_hours(db, 1, 2025) == 8)

print("\nEDITING an entry is judged on the change, not old plus new:")
# 8 hours already logged on this uuid. Re-submitting it lower must be allowed:
# the entry being replaced is not spent twice.
log_pto(1, 8, "2026-09-01", uuid="edit-me")
check("used includes the entry", pto_used_hours(db, 1, 2026) == 40)
check("lowering that entry is allowed",
      check_pto_allowed(db, eligible, "2026-09-01", 4, exclude_entry_uuid="edit-me") is None,
      "the old value must not be counted against its own replacement")
# 32 hours are used by OTHER entries, so excluding this one leaves 8 free. The
# edit may grow to fill exactly that, and no further. (An earlier draft of this
# file asserted it could grow to the full 40 and reported the implementation as
# broken - it had forgotten the other 32 hours were still spent.)
check("raising it to fill the remaining allowance is allowed",
      check_pto_allowed(db, eligible, "2026-09-01", 8, exclude_entry_uuid="edit-me") is None)
check("but raising it past what is left is refused",
      check_pto_allowed(db, eligible, "2026-09-01", 8.25, exclude_entry_uuid="edit-me") is not None)
check("and a DIFFERENT uuid does not get the exclusion",
      check_pto_allowed(db, eligible, "2026-09-01", 4, exclude_entry_uuid="some-other") is not None)

print("\nAn allowance lowered after the fact does not create a debt:")
eligible.pto_hours_annual = 8
db.commit()
b2 = pto_balance(db, eligible, 2026)
check("remaining clamps at zero rather than going negative",
      b2["remaining_hours"] == 0, str(b2["remaining_hours"]))
check("and used still reports the truth", b2["used_hours"] == 40, str(b2["used_hours"]))
eligible.pto_hours_annual = 40
db.commit()

print("\nA missing or malformed date is refused, not guessed:")
check("no date is refused", check_pto_allowed(db, eligible, None, 4) is not None)
check("a junk date is refused", check_pto_allowed(db, eligible, "not-a-date", 4) is not None)

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
