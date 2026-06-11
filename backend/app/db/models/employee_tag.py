"""
EmployeeTag + user-tag association.

Admin-managed list of role / skill tags an admin can attach to crew members
(Driver, Has CC, YC pass, Tier I-IV, Art Hanger, Crating, Specialty Packing,
plus whatever else admin creates). The tag list itself lives in the Settings
tab; per-user assignment lives in the Employees tab.

Join table is a plain Table (no model class) — we only ever read/write the
pair, never any join-row metadata.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table
from app.db.session import Base


class EmployeeTag(Base):
    __tablename__ = "employee_tags"

    id = Column(Integer, primary_key=True, index=True)

    # Display name. Unique so admin can't accidentally duplicate ("Driver" vs
    # "driver"). Case-sensitivity is left to Postgres; admin should pick a
    # canonical spelling and re-use it.
    name = Column(String(64), unique=True, nullable=False)

    # Manual ordering for the Settings list and the Employees tab chips. Lets
    # admin arrange tiers in order rather than alphabetically.
    sort_order = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


user_employee_tags = Table(
    "user_employee_tags",
    Base.metadata,
    Column(
        "user_id",
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "tag_id",
        Integer,
        ForeignKey("employee_tags.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
