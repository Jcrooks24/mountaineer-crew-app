"""A bonus paid to an employee through payroll.

Company money, unlike a tip, which is a customer's. Structurally the two are
identical - a person, a date, a flat amount, an optional job, a note, and who
entered it - so they share a worksheet with a `kind` column rather than each
having their own. They are separate TABLES because they answer different
questions ("what did customers tip?" is not "what did we pay out in bonuses?")
and merging them would make every existing tips query wrong.

Dated by PAYOUT, exactly like a tip: the bonus lands in whichever period
contains `bonus_date`, which defaults to today. A bonus decided in arrears for
work done last month is paid on the current run rather than being added to a
period that has already been finalized.

`job_uuid` is reference only and deliberately not a foreign key: a bonus is money
owed and must survive the job row changing.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text

from app.db.session import Base


class EmployeeBonus(Base):
    __tablename__ = "employee_bonuses"

    id = Column(Integer, primary_key=True, index=True)

    bonus_uuid = Column(String, unique=True, index=True, nullable=False)

    job_uuid = Column(String, nullable=True, index=True)
    job_name = Column(String, nullable=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_name = Column(String, nullable=False)

    # ISO YYYY-MM-DD. The PAYOUT date, which decides the pay period.
    bonus_date = Column(String, nullable=False, index=True)
    amount = Column(Numeric(precision=10, scale=2), nullable=False)
    note = Column(Text, nullable=False, server_default="", default="")

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
