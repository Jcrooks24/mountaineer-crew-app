"""
JobBill model.
Stores a per-job bill/invoice with editable line items, per-item discounts, and a global discount.
"""
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from app.db.session import Base


class JobBill(Base):
    __tablename__ = "job_bills"

    id = Column(Integer, primary_key=True, index=True)
    job_uuid = Column(String, unique=True, index=True, nullable=False)

    saved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    saved_by_name = Column(String, nullable=True)

    # JSON-encoded list of LineItem dicts
    items_json = Column(Text, nullable=False, default="[]")
    global_discount = Column(Float, nullable=False, default=0.0)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
