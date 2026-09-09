"""The payroll review workflow's integrity rules, EXERCISED against a database.
`python scripts/test_payroll_review_integrity.py`

WHY THIS EXISTS. The rules below are all stated somewhere - in an ADR, in a
docstring, in a code comment - and every one of them was previously "verified"
by reading the source or grepping for a phrase. The vetting protocol is explicit
that this is not evidence: the route-splitting change shipped with 38 passing
assertions, one of which proved a true statement with no bearing on the failure.

So this builds real rows in a real (in-memory) database, runs the real
`_build_summary` and the real finalize query, and checks the NUMBERS.

Each block names the production symptom it would catch.

No network, no credentials, no Sheets.
"""

import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import app.routers.payroll as pr  # noqa: E402
from app.db.models.admin_entry_status import AdminEntryStatus  # noqa: E402
from app.db.models.event import Event  # noqa: E402
from app.db.models.job import Job  # noqa: E402
from app.db.models.job_report import JobReport  # noqa: E402
from app.db.models.off_job_entry import OffJobEntry  # noqa: E402
from app.db.models.office_hours import OfficeHoursEntry  # noqa: E402
from app.db.models.payroll_correction import PayrollCorrection  # noqa: E402
from app.db.models.reimbursement import Reimbursement  # noqa: E402
from app.db.models.user import User  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# Every table, not a hand-picked subset. _build_summary reaches further than it
# looks (long-distance days for per-diem, events for report-less jobs), and a
# missing table surfaces as an OperationalError halfway through a block rather
# than as a clear failure. Importing app.main pulls in every model's module so
# Base.metadata is complete before create_all runs.
import app.main  # noqa: E402,F401
from app.db.session import Base  # noqa: E402

S, E = date(2026, 9, 1), date(2026, 9, 14)
NOW = datetime(2026, 9, 15, 9, 0, 0)


def fresh():
    """A database per block, so one block's rows cannot explain another's pass."""
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(User(id=1, email="dylan@example.com", name="Dylan Reed",
                password_hash="x", role="crew", is_active=True))
    db.commit()
    return db


def correction(**kw):
    base = dict(user_id=1, user_name="Dylan Reed", source="off_job",
                source_key="oj-1", bucket="billable", original_hours=8.0,
                corrected_hours=5.0, reason="Left at 2, not 5.", notify=True,
                work_date="2026-09-03", created_at=NOW, updated_at=NOW)
    base.update(kw)
    return PayrollCorrection(**base)


def off_job(**kw):
    base = dict(entry_uuid="oj-1", submitted_by_id=1, submitted_by_name="Dylan Reed",
                work_date="2026-09-03", hours=8.0, pay_structure="regular",
                notes="Shop work.", created_at=NOW, updated_at=NOW)
    base.update(kw)
    return OffJobEntry(**base)


def hours_for(summary, name="Dylan Reed"):
    for e in summary["employees"]:
        if e["name"] == name:
            return e["totals"]
    return None


def finalize_would_mail(db, s, e):
    """The REAL query finalize_period uses to decide what to mail, lifted so the
    test cannot drift from it by paraphrase. Kept in sync by asserting below that
    the router still contains the same two clauses."""
    from sqlalchemy import and_, or_
    return (
        db.query(PayrollCorrection)
        .filter(
            PayrollCorrection.job_uuid.is_(None),
            PayrollCorrection.notified_at.is_(None),
            or_(
                and_(PayrollCorrection.period_start == s.isoformat(),
                     PayrollCorrection.period_end == e.isoformat()),
                and_(PayrollCorrection.period_start.is_(None),
                     PayrollCorrection.work_date >= s.isoformat(),
                     PayrollCorrection.work_date <= e.isoformat()),
            ),
        )
        .all()
    )


# ── 1. Paid set == mailed set ────────────────────────────────────────────────
# SYMPTOM IT CATCHES: an employee's pay is corrected and they are never told.
# A date-scoped non-job correction (an off-job correction) is invisible to the
# Job Summary mailer, which keys on job_uuid, and to the period mailer, which
# keys on period_start. Before ADR 0045 it was applied by neither read path.
print("An off-job correction is BOTH paid and mailed:")
db = fresh()
db.add(off_job())
db.add(correction(period_start=None, period_end=None))
db.commit()

summary = pr._build_summary(db, S, E)
t = hours_for(summary)
check("the corrected figure is what payroll pays",
      t is not None and abs(t["total_hours"] - 5.0) < 1e-6,
      f"total_hours={t and t['total_hours']} (expected 5.0, the correction, not 8.0)")
mail = finalize_would_mail(db, S, E)
check("and finalize would mail exactly that one correction",
      len(mail) == 1 and mail[0].corrected_hours == 5.0, f"{len(mail)} queued")
check("the pending count the Finalize button reads agrees",
      summary["pending_correction_count"] == 1,
      str(summary["pending_correction_count"]))

# The regression this replaced: keyed on job_uuid, the row was neither.
print("\nThe pre-ADR-0045 rule would have dropped it (regression guard):")
old_paid = (
    db.query(PayrollCorrection)
    .filter(PayrollCorrection.job_uuid.isnot(None),
            PayrollCorrection.work_date >= S.isoformat(),
            PayrollCorrection.work_date <= E.isoformat())
    .all()
)
check("the old job_uuid-keyed read finds nothing", old_paid == [])
old_mail = (
    db.query(PayrollCorrection)
    .filter(PayrollCorrection.job_uuid.is_(None),
            PayrollCorrection.period_start == S.isoformat())
    .all()
)
check("and the old period-keyed mail query finds nothing too", old_mail == [],
      "this is the exact pair that made the row payable-but-unmailable")

# ── 2. A correction REPLACES, it does not stack ──────────────────────────────
# SYMPTOM IT CATCHES: correcting the same line twice halves or doubles somebody's
# pay. ADR 0029 says a correction is an override, not an adjustment.
print("\nCorrecting the same line twice is an edit, not two adjustments:")
db = fresh()
db.add(off_job())
c = correction(period_start=None, period_end=None, corrected_hours=5.0)
db.add(c)
db.commit()
c.corrected_hours = 6.0          # the admin changes their mind
db.commit()
t = hours_for(pr._build_summary(db, S, E))
check("the second value wins outright", abs(t["total_hours"] - 6.0) < 1e-6,
      f"total_hours={t['total_hours']} (11.0 would mean they stacked)")

# ── 3. PTO never reaches overtime ────────────────────────────────────────────
# SYMPTOM IT CATCHES: paid time off pushes somebody past forty and the company
# pays overtime for hours nobody worked.
print("\nPTO is paid but never counts toward overtime:")
db = fresh()
# 38 billable hours plus 8 hours of PTO in one week = 46 total, 0 OT.
db.add(off_job(entry_uuid="w-1", work_date="2026-09-01", hours=38.0, pay_structure="regular"))
db.add(off_job(entry_uuid="p-1", work_date="2026-09-02", hours=8.0, pay_structure="pto"))
db.commit()
t = hours_for(pr._build_summary(db, S, E))
check("the PTO hours are paid", abs(t["pto_hours"] - 8.0) < 1e-6, str(t["pto_hours"]))
check("they are NOT in the billable bucket",
      abs(t["regular_hours"] - 38.0) < 1e-6, f"regular={t['regular_hours']}")
check("and they generate no overtime",
      abs(t["ot_hours"]) < 1e-6,
      f"ot={t['ot_hours']} - 46 total would be 6h OT if PTO leaked into billable")

# ── 4. The review gate ───────────────────────────────────────────────────────
# SYMPTOM IT CATCHES: payroll runs over a job nobody checked. And the narrower
# one: waiving a report-less job also exempts it from the initialing gate.
print("\nThe review gate blocks on an un-initialed job:")
db = fresh()
# A job is dated by its earliest EVENT, so the fixture needs one - a report
# alone is not enough to place a job in a period.
db.add(Event(event_id="ev-1", job_uuid="job-1", job_name="Smith move", type="start",
             timestamp=datetime(2026, 9, 3, 15, 0, 0), logged_at=NOW))
db.add(JobReport(job_uuid="job-1", billing_method="hourly", review_candidate="no",
                 hours_match=True,
                 employee_hours_json='[{"user_id": 1, "name": "Dylan Reed", "hours": 8, "date": "2026-09-03"}]',
                 created_at=NOW, updated_at=NOW))
db.commit()
summary = pr._build_summary(db, S, E)
pending = {p["job_uuid"] for p in summary["jobs_pending_review"]}
check("an un-initialed job with hours is pending", "job-1" in pending, str(pending))

db.add(AdminEntryStatus(job_uuid="job-1", entered_by="Office", entered_on="2026-09-15",
                        validated=True, corrected=True, confirmed_in_sheet=True,
                        updated_at=NOW))
db.commit()
summary = pr._build_summary(db, S, E)
check("initialing clears it",
      "job-1" not in {p["job_uuid"] for p in summary["jobs_pending_review"]})

print("\nA waiver is not a review:")
db = fresh()
db.add(Event(event_id="ev-2", job_uuid="job-2", job_name="Waived job", type="start",
             timestamp=datetime(2026, 9, 3, 15, 0, 0), logged_at=NOW))
db.add(JobReport(job_uuid="job-2", billing_method="hourly", review_candidate="no",
                 hours_match=True,
                 employee_hours_json='[{"user_id": 1, "name": "Dylan Reed", "hours": 8, "date": "2026-09-03"}]',
                 created_at=NOW, updated_at=NOW))
db.add(AdminEntryStatus(job_uuid="job-2", entered_by="(waived)", entered_on="2026-09-15",
                        report_waived=True, validated=None, updated_at=NOW))
db.commit()
summary = pr._build_summary(db, S, E)
check("a waiver row does not exempt a job from the initialing gate",
      "job-2" in {p["job_uuid"] for p in summary["jobs_pending_review"]},
      "the waiver says 'no report is coming', never 'I checked this'")

# ── 5. Reimbursements: pay unless declined, but a decline stays visible ──────
# SYMPTOM IT CATCHES: a forgotten approval silently underpays somebody (the old
# approved-only gate did this for months); or a mis-click becomes unrecoverable
# because the declined row vanishes from the screen.
print("\nReimbursements are paid unless declined, and a decline stays visible:")
db = fresh()
db.add(Reimbursement(reimbursement_uuid="r-ok", user_id=1, user_name="Dylan Reed",
                     type="expense", vendor="Straps", amount=40.0,
                     expense_date="2026-09-03", status="submitted",
                     payment_method="personal", created_at=NOW, updated_at=NOW))
db.add(Reimbursement(reimbursement_uuid="r-no", user_id=1, user_name="Dylan Reed",
                     type="expense", vendor="Wrong receipt", amount=999.0,
                     expense_date="2026-09-04", status="rejected",
                     payment_method="personal", created_at=NOW, updated_at=NOW))
db.commit()
summary = pr._build_summary(db, S, E)
emp = summary["employees"][0]
check("an un-reviewed claim is still paid",
      abs(emp["totals"]["reimbursement_amount"] - 40.0) < 1e-6,
      f"${emp['totals']['reimbursement_amount']} - a zero here is the old silent underpay")
check("a rejected claim is not paid",
      abs(emp["totals"]["reimbursement_amount"] - 40.0) < 1e-6,
      "999 would mean rejections are summed")
check("but it is still on screen, so a mis-click can be undone",
      any(i["uuid"] == "r-no" for i in emp["reimbursement_items"]))
check("and the un-reviewed one is counted for the finalize warning",
      emp["reimbursements_unreviewed"] == 1, str(emp["reimbursements_unreviewed"]))

# ── 6. The router still uses the query this test models ──────────────────────
# SYMPTOM IT CATCHES: this file passing forever after the router stopped
# matching it. A hand-copied query is only evidence while it is still the query.
print("\nThe finalize query modelled above is still the one in the router:")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "app", "routers", "payroll.py"), encoding="utf-8").read()
fin = src[src.index("def finalize_period("):]
fin = fin[:fin.index("by_user: Dict[int, List[PayrollCorrection]]")]
check("it excludes job corrections", "PayrollCorrection.job_uuid.is_(None)" in fin)
check("it matches period-scoped rows by period",
      "PayrollCorrection.period_start == s.isoformat()" in fin)
check("it matches date-scoped rows by work_date",
      "PayrollCorrection.period_start.is_(None)" in fin
      and "PayrollCorrection.work_date >= s.isoformat()" in fin)
check("and only un-notified ones", "PayrollCorrection.notified_at.is_(None)" in fin)

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
