"""
Long Distance compliance records.

Stores a driver's Prior On-Duty Hours Statement (FMCSR §395.8(j)(2)) which
records their on-duty hours for the seven consecutive days before starting
an interstate trip. Required for crews operating across state lines.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


class PriorOnDutyStatement(Base):
    __tablename__ = "prior_on_duty_statements"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent submission
    statement_id = Column(String, unique=True, index=True, nullable=False)

    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_name = Column(String, nullable=False)

    # YYYY-MM-DD — the date the statement covers (first day of trip)
    statement_date = Column(String, nullable=False)

    # JSON: [{ "date": "YYYY-MM-DD", "hours": 0.0 }, ...] for the 7 days before
    daily_hours_json = Column(Text, nullable=False)

    # Hours worked in the 24 hours immediately preceding trip start
    hours_last_24 = Column(String, nullable=False, default="0")

    signature = Column(Text, nullable=False)   # base64 PNG data URL
    signed_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False)


class RodsLog(Base):
    """Record of Duty Status (FMCSR §395.8) — one row per driver per day."""

    __tablename__ = "rods_logs"

    id = Column(Integer, primary_key=True, index=True)

    rods_id = Column(String, unique=True, index=True, nullable=False)

    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_name = Column(String, nullable=False)

    log_date = Column(String, nullable=False)  # YYYY-MM-DD
    co_driver_name = Column(String, nullable=True)
    vehicle_number = Column(String, nullable=True)
    trailer_number = Column(String, nullable=True)

    origin = Column(String, nullable=True)
    destination = Column(String, nullable=True)
    total_miles = Column(String, nullable=True)        # stored as string to stay flexible
    shipping_docs = Column(String, nullable=True)      # BOL / manifest / order numbers
    carrier = Column(String, nullable=True, default="Mountaineer Moving Co.")
    main_office_address = Column(String, nullable=True)

    # JSON array of { time: "HH:MM", status: "off_duty"|"sleeper"|"driving"|"on_duty", location, remarks }
    duty_changes_json = Column(Text, nullable=False)
    remarks = Column(Text, nullable=True)

    # Computed daily totals (also recomputed on the frontend)
    total_off_duty = Column(String, nullable=True)
    total_sleeper = Column(String, nullable=True)
    total_driving = Column(String, nullable=True)
    total_on_duty = Column(String, nullable=True)

    signature = Column(Text, nullable=False)  # base64 PNG data URL
    signed_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False)
