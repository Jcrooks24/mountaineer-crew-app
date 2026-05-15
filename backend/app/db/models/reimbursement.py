"""
Reimbursement model.

Tracks crew reimbursement requests in two flavors:

- type = "mileage":   personal-vehicle travel. Start + end odometer photos
                      land in Drive; admin computes the dollar payout from
                      the difference (mileage rates aren't stored in-app).
- type = "expense":   business expense paid with a personal card. Single
                      receipt photo + crew-entered dollar amount.

One row per submission, identified by reimbursement_uuid (offline-
idempotency key, same pattern as materials_submissions.submission_id).
Photos are uploaded to Google Drive first; this row stores the file ids
and viewer URLs so the Bills/admin views can link out.

Approval lives on the same row — admin sets status, approver_name, etc.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from app.db.session import Base


# Allowed values, kept here so frontend + sheets export stay in sync.
REIMBURSEMENT_TYPES = ("mileage", "expense")
REIMBURSEMENT_STATUSES = ("submitted", "approved", "rejected")
# Expense payment method:
#   "personal" — paid with a personal card; the crew wants reimbursement.
#   "company"  — paid with a company card; this is an expense log only,
#                no money is owed back. Null for mileage rows.
REIMBURSEMENT_PAYMENT_METHODS = ("personal", "company")


class Reimbursement(Base):
    __tablename__ = "reimbursements"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent retries.
    reimbursement_uuid = Column(String, unique=True, index=True, nullable=False)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String, nullable=False)

    # One of REIMBURSEMENT_TYPES — drives which photo/amount columns the
    # admin should read on the sheet.
    type = Column(String(16), nullable=False, index=True)

    # Optional link to a specific job — many trips/expenses are job-related
    # but office reimbursements (e.g. admin running a supplies errand) won't
    # have a job. Stored as strings to match the rest of the codebase.
    job_uuid = Column(String, nullable=True)
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)

    # Mileage fields — both null for expense rows.
    odometer_start = Column(Integer, nullable=True)
    odometer_end = Column(Integer, nullable=True)
    odometer_start_photo_drive_id = Column(String, nullable=True)
    odometer_start_photo_url = Column(String, nullable=True)
    odometer_end_photo_drive_id = Column(String, nullable=True)
    odometer_end_photo_url = Column(String, nullable=True)

    # Expense fields — null for mileage rows.
    amount = Column(Numeric(precision=10, scale=2), nullable=True)
    category = Column(String, nullable=True)   # one of the fixed expense categories
    receipt_photo_drive_id = Column(String, nullable=True)
    receipt_photo_url = Column(String, nullable=True)
    # "personal" (reimburse the crew) or "company" (expense log only).
    # Null for mileage rows. See REIMBURSEMENT_PAYMENT_METHODS.
    payment_method = Column(String(16), nullable=True)

    notes = Column(Text, nullable=True)

    # Approval workflow — defaults to "submitted". Admin endpoints flip to
    # approved/rejected and stamp approver_*.
    status = Column(String(16), nullable=False, default="submitted")
    approver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approver_name = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_notes = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
