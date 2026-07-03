"""
DVIR (Driver Vehicle Inspection Report) model.
FMCSA 49 CFR §396.11 compliant inspection record with driver and mechanic signatures.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


class DVIR(Base):
    __tablename__ = "dvirs"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent submission
    dvir_id = Column(String, unique=True, index=True, nullable=False)

    # ── Vehicle ──────────────────────────────────────────────────────────────
    vehicle_number = Column(String, nullable=False)
    trailer_number = Column(String, nullable=True)
    odometer = Column(Integer, nullable=True)

    # ── Trip ─────────────────────────────────────────────────────────────────
    inspection_type = Column(String, nullable=False)   # "pre-trip" | "post-trip"
    inspection_date = Column(String, nullable=False)   # YYYY-MM-DD

    # ── Optional job linkage (offline-first pattern) ─────────────────────────
    job_uuid = Column(String, index=True, nullable=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=True)

    # ── Inspection results ───────────────────────────────────────────────────
    # JSON array of defect category strings, e.g. '["Brakes","Tires"]'
    defects_json = Column(Text, nullable=True)
    defect_notes = Column(Text, nullable=True)
    # "satisfactory" or "defects_noted"
    condition = Column(String, nullable=False, default="satisfactory")

    # ── Back-of-truck confirmation ───────────────────────────────────────────
    # Pre-trip: driver confirmed truck loaded with everything needed for the job
    # Post-trip: driver confirmed truck reset for next crew (gear, secured,
    #   block heater in winter, clean/free of debris)
    back_of_truck_confirmed = Column(Boolean, nullable=True)
    # Post-trip only: truck was left loaded overnight (client belongings or trash
    # for disposal) - back-of-truck post-trip confirmation does not apply.
    overnight_hold = Column(Boolean, nullable=True)

    # ── Driver authorization ─────────────────────────────────────────────────
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    driver_name = Column(String, nullable=False)
    driver_signature = Column(Text, nullable=False)   # base64 PNG data URL
    driver_signed_at = Column(DateTime, nullable=False)

    # ── Mechanic approval ────────────────────────────────────────────────────
    mechanic_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    mechanic_name = Column(String, nullable=True)
    mechanic_signature = Column(Text, nullable=True)  # base64 PNG data URL
    mechanic_signed_at = Column(DateTime, nullable=True)
    # True = repairs were made, False = no repairs needed, None = not yet reviewed
    repairs_made = Column(Boolean, nullable=True)
    mechanic_notes = Column(Text, nullable=True)

    # ── Remote mechanic signature request ────────────────────────────────────
    # Set when an admin emails a remote sign-off link to a mechanic. Lets the
    # Admin → DVIR Review screen show "request sent to X" while awaiting the
    # mechanic's remote signature. Cleared implicitly once mechanic_signature
    # is populated (the DVIR is then approved).
    mechanic_signature_requested_at = Column(DateTime, nullable=True)
    mechanic_signature_requested_email = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
