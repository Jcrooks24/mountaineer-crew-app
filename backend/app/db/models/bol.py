"""
DigitalBOL model - Digital Bill of Lading for interstate (long-distance) moves.

One row per BOL, identified by bol_id (device-generated UUID, offline-
idempotency key - same pattern as materials_submissions.submission_id and
reimbursements.reimbursement_uuid). The crew builds the declared inventory in
the field; items are serialized as JSON so no separate line-item table is
needed (same approach as materials/estimates).

Writes are UPSERTS by bol_id (not insert-once): the same BOL is re-submitted
as per-item photo Drive links finish uploading and, in a later push, as the
origin and destination signatures are captured. The Sheets export uses a
replace strategy so re-submits never duplicate rows.

Push 1 populates the inventory (items_json) + job autofill. The signature /
PDF columns are added now (nullable) so the two-signing-session flow
(origin before loading, destination on delivery - mirrors the DVIR driver +
mechanic pattern) drops in cleanly in Push 2 without another migration.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from app.db.session import Base


# Allowed status values, kept here so frontend + sheets export stay in sync.
#   draft         - inventory being built / no signatures yet (Push 1)
#   origin_signed - shipper + carrier rep signed at origin before loading
#   delivered     - shipper + carrier rep signed at destination on delivery
BOL_STATUSES = ("draft", "origin_signed", "delivered")


class DigitalBOL(Base):
    __tablename__ = "digital_bols"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent retries / upserts.
    bol_id = Column(String, unique=True, index=True, nullable=False)

    # Crew rep who created / owns the BOL (not trusted from the client - set
    # server-side from the authenticated user).
    created_by = Column(String, nullable=False, default="")
    driver_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Job linkage - the BOL is a per-job document. Stored as strings to match
    # the rest of the codebase (jobs are identified by job_uuid, not name).
    job_uuid = Column(String, index=True, nullable=True)
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)

    status = Column(String(16), nullable=False, default="draft")

    # Static carrier block (Mountaineer Moving LLC, DOT/MC numbers, etc.) and
    # autofilled shipment details (estimate #, addresses, dates) captured for
    # the record / the PDF. JSON blobs so the schema doesn't churn as the BOL
    # form grows. Nullable in Push 1.
    carrier_json = Column(Text, nullable=True)
    shipment_json = Column(Text, nullable=True)

    # JSON-encoded list of BOL items:
    #   { item_no, id, name, qty, condition_notes,
    #     photos: [{ photo_id, drive_url, thumb_url, caption }] }
    items_json = Column(Text, nullable=False, default="[]")

    # ── Push 2: signatures (base64 PNG data URLs, same as DVIR/RODS) ──────────
    # Origin signing - before loading.
    origin_shipper_sig = Column(Text, nullable=True)
    origin_carrier_sig = Column(Text, nullable=True)
    origin_signed_at = Column(DateTime, nullable=True)
    # Destination signing - on delivery, after the final walk-through.
    dest_shipper_sig = Column(Text, nullable=True)
    dest_carrier_sig = Column(Text, nullable=True)
    dest_signed_at = Column(DateTime, nullable=True)
    walkthrough_notes = Column(Text, nullable=True)
    final_charges = Column(Numeric(precision=10, scale=2), nullable=True)

    # ── Push 2: signed PDF stored in its own Drive folder ────────────────────
    signed_pdf_drive_id = Column(String, nullable=True)
    signed_pdf_url = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
