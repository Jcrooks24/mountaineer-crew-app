"""A tip paid out to one employee.

Tips already existed in this app as a line on the BILL - money charged to the
customer. Nothing paid one to anybody. This is the other half: a dollar amount
owed to a named crew member, which payroll adds to their period.

WHY IT IS NOT ATTACHED TO A PAY PERIOD BY THE JOB'S DATE. Tips arrive late. A
customer rings the office two weeks after a move and leaves something for the
crew, and the period that job belonged to has been finalized and paid. Keying the
tip to the job's date would drop it into a closed period, where it would either
be missed or force the admin to re-open a run they have already reconciled.

So `tip_date` is when the tip is being PAID OUT - it defaults to the day the
admin records it - and that is what decides the period. `job_uuid` is kept purely
so the office can see which job a tip came from; it does not affect the money's
timing. Recording a tip against a job the crew ran in July, today, pays it today.

Entered from either of two places, which is why the job link is optional:
  - the admin Job Summary, when a tip comes in for a specific job
  - the payroll screen, as a straight per-employee amount

FLAT AMOUNTS, MANUALLY ENTERED. There is no split rule and no derivation from
hours. The office decides who gets what and types it in. A tip is a gift with
someone's judgement attached, and inventing an allocation formula would put the
app's opinion where the office's belongs.
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)

from app.db.session import Base


class EmployeeTip(Base):
    __tablename__ = "employee_tips"

    id = Column(Integer, primary_key=True, index=True)

    # Client-mintable so a retry cannot create a second tip. Tips are money and
    # a duplicated one is an overpayment nobody notices until reconciliation.
    tip_uuid = Column(String, unique=True, index=True, nullable=False)

    # Which job this was for, when it was for one. REFERENCE ONLY - it does not
    # decide the pay period (see the module docstring). NULL for a tip entered
    # straight onto payroll with no job behind it.
    job_uuid = Column(String, nullable=True, index=True)
    # Captured at entry so the record still reads sensibly if the job is renamed.
    job_name = Column(String, nullable=True)

    # Who is being paid. user_id is the key; the name is kept for display and so
    # the row survives the roster entry being deactivated.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_name = Column(String, nullable=False)

    # The payout date, ISO YYYY-MM-DD. This is what puts the tip in a period.
    tip_date = Column(String, nullable=False, index=True)

    # Dollars. Numeric, not Float: this is money and it is summed.
    amount = Column(Numeric(precision=10, scale=2), nullable=False, default=0)

    note = Column(Text, nullable=False, default="")

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


# Payroll reads by (date window, user). Both are in the index so a period's
# lookup does not scan the table as tips accumulate season over season.
Index("ix_employee_tips_date_user", EmployeeTip.tip_date, EmployeeTip.user_id)
