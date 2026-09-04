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

Approval lives on the same row - admin sets status, approver_name, etc.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from app.db.session import Base


# Allowed values, kept here so frontend + sheets export stay in sync.
REIMBURSEMENT_TYPES = ("mileage", "expense")
REIMBURSEMENT_STATUSES = ("submitted", "approved", "rejected")
# Expense payment method:
#   "personal" - paid with a personal card; the crew wants reimbursement.
#   "company"  - paid with a company card; this is an expense log only,
#                no money is owed back. Null for mileage rows.
REIMBURSEMENT_PAYMENT_METHODS = ("personal", "company")


class Reimbursement(Base):
    __tablename__ = "reimbursements"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID for idempotent retries.
    reimbursement_uuid = Column(String, unique=True, index=True, nullable=False)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String, nullable=False)

    # One of REIMBURSEMENT_TYPES - drives which photo/amount columns the
    # admin should read on the sheet.
    type = Column(String(16), nullable=False, index=True)

    # Optional link to a specific job - many trips/expenses are job-related
    # but office reimbursements (e.g. admin running a supplies errand) won't
    # have a job. Stored as strings to match the rest of the codebase.
    job_uuid = Column(String, nullable=True)
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)

    # Crew-entered date the expense / trip actually occurred (YYYY-MM-DD).
    # Distinct from created_at, which is the submission timestamp - crew often
    # log on a different day from the actual event.
    expense_date = Column(String, nullable=True)

    # Mileage fields - both null for expense rows.
    odometer_start = Column(Integer, nullable=True)
    odometer_end = Column(Integer, nullable=True)
    odometer_start_photo_drive_id = Column(String, nullable=True)
    odometer_start_photo_url = Column(String, nullable=True)
    odometer_end_photo_drive_id = Column(String, nullable=True)
    odometer_end_photo_url = Column(String, nullable=True)

    # Expense fields - null for mileage rows.
    amount = Column(Numeric(precision=10, scale=2), nullable=True)
    category = Column(String, nullable=True)   # one of the fixed expense categories
    # Free-text store/business the purchase was made at (e.g. "Home Depot").
    vendor = Column(String, nullable=True)
    receipt_photo_drive_id = Column(String, nullable=True)
    receipt_photo_url = Column(String, nullable=True)
    # "personal" (reimburse the crew) or "company" (expense log only).
    # Null for mileage rows. See REIMBURSEMENT_PAYMENT_METHODS.
    payment_method = Column(String(16), nullable=True)

    # One "click here for the photo(s)" Drive link per submission, surfaced
    # in the Reimbursements sheet. For mileage it points at the per-
    # submission odometer folder; for an expense it points at the receipt
    # file. Null if the submission had no photos.
    photos_drive_url = Column(String, nullable=True)

    notes = Column(Text, nullable=True)

    # Approval workflow - defaults to "submitted". Admin endpoints flip to
    # approved/rejected and stamp approver_*.
    status = Column(String(16), nullable=False, default="submitted")
    approver_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approver_name = Column(String, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_notes = Column(Text, nullable=True)

    # PAYMENT, which is a different fact from approval. Stamped when a payroll
    # period that included this claim is finalized. NULL means "not paid through
    # the app" - true for everything filed before this existed, and for anything
    # settled outside it. Kept separate from `status` so approving and paying
    # cannot overwrite each other.
    paid_at = Column(DateTime, nullable=True)
    # Which payroll run paid it. "Paid" without "on which run" cannot be
    # reconciled against anything.
    paid_period_start = Column(String(10), nullable=True)
    paid_period_end = Column(String(10), nullable=True)

    # QUICKBOOKS. The office re-keys these by hand, and nothing recorded whether
    # a claim had been entered yet - so the only guard against entering the same
    # receipt twice was somebody's memory. Two states: "pending" and "entered".
    # A declined claim never reaches QuickBooks at all, which `status` already
    # says, so that is not a third value here.
    qb_status = Column(String(16), nullable=False, server_default="pending", default="pending")
    qb_entered_at = Column(DateTime, nullable=True)
    qb_entered_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
