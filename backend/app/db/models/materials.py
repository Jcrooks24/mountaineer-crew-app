"""
MaterialsSubmission model.
Stores a completed materials form submission for a job.
Items are serialized as JSON so no separate line-item table is needed.
"""

from sqlalchemy import Column, Integer, String, DateTime, Float
from app.db.session import Base


class MaterialsSubmission(Base):
    __tablename__ = "materials_submissions"

    id = Column(Integer, primary_key=True, index=True)

    # UUID generated on device — used for idempotent upserts
    submission_id = Column(String, unique=True, index=True, nullable=False)

    created_at = Column(DateTime, nullable=False)

    job_uuid = Column(String, index=True, nullable=False)
    job_label = Column(String, nullable=True)
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)

    notes = Column(String, nullable=True)

    # JSON-encoded list of MaterialLineItem objects
    items_json = Column(String, nullable=False, default="[]")

    total = Column(Float, nullable=False, default=0.0)
