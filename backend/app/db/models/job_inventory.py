"""
Job Inventory model.

The *actual* inventory a crew logs on a job (as opposed to the Estimator's
pre-move estimate). Furniture count and box count are derived from these rows
(box vs furniture via `is_box`), and the list is the actual side of the
Phase 5 overage comparison against the linked estimate.

Keyed by `job_uuid` (the universal job key) - there is no parent row; items
are added directly against a job, mirroring how events/materials/photos attach.
Modeled on EstimateItem so the frontend can reuse the same item-row UX.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from app.db.session import Base


class JobInventoryItem(Base):
    __tablename__ = "job_inventory_items"

    id = Column(Integer, primary_key=True, index=True)

    # Universal job key (shared with events, materials, photos, job reports).
    job_uuid = Column(String, index=True, nullable=False)

    name = Column(String, nullable=False)
    qty = Column(Integer, nullable=False, default=1)

    # Box vs furniture. Auto-filled on the client from the catalog "Boxes"
    # category; drives box_count vs furniture_count. Boxes are counted, not
    # itemized individually, but each add still records a row with its qty.
    is_box = Column(Boolean, nullable=False, default=False)

    room = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
