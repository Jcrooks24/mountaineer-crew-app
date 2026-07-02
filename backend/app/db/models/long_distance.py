"""
Long Distance compliance records.

Stores a driver's Prior On-Duty Hours Statement (FMCSR §395.8(j)(2)) which
records their on-duty hours for the seven consecutive days before starting
an interstate trip. Required for crews operating across state lines.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


class PriorOnDutyStatement(Base):
    __tablename__ = "prior_on_duty_statements"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent submission
    statement_id = Column(String, unique=True, index=True, nullable=False)

    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_name = Column(String, nullable=False)

    # Optional link to the trip's job so "is the PODS done for THIS trip?" can be
    # answered (the statement is one-per-trip; the LD job is the trip).
    job_uuid = Column(String, index=True, nullable=True)
    job_name = Column(String, nullable=True)

    # YYYY-MM-DD - the date the statement covers (first day of trip)
    statement_date = Column(String, nullable=False)

    # JSON: [{ "date": "YYYY-MM-DD", "hours": 0.0 }, ...] for the 7 days before
    daily_hours_json = Column(Text, nullable=False)

    # Hours worked in the 24 hours immediately preceding trip start
    hours_last_24 = Column(String, nullable=False, default="0")

    signature = Column(Text, nullable=False)   # base64 PNG data URL
    signed_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False)


class RodsLog(Base):
    """Record of Duty Status (FMCSR §395.8) - one row per driver per day."""

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

    # Nullable: an in-progress day is autosaved to the server unsigned (for
    # continuity / cross-device resume); the signature is set when finalized.
    signature = Column(Text, nullable=True)  # base64 PNG data URL
    signed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False)


class LdDay(Base):
    """One row per driver per day on a long-distance trip, for payroll.

    The driver marks whether a given day was spent out of town (drives $50/day
    per-diem, incorporated into the client's long-distance fee) and/or a drive
    day (drive time is paid a fixed amount off-app). This exists so admin can
    tally per-diem owed and drive days per employee from the sheet - the app
    doesn't compute the fixed drive-pay dollar figure. Upserted by (driver, date).
    """

    __tablename__ = "long_distance_days"

    id = Column(Integer, primary_key=True, index=True)
    day_id = Column(String, unique=True, index=True, nullable=False)  # device UUID

    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_name = Column(String, nullable=False)

    # Optional link to the job the trip is for.
    job_uuid = Column(String, index=True, nullable=True)
    job_name = Column(String, nullable=True)

    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD

    out_of_town = Column(Boolean, nullable=False, default=False)
    drive_day = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
