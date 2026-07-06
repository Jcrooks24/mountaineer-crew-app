"""
Estimator - admin-only in-home estimate records with inventory and site notes.

Photos reuse the existing photos table via job_uuid (set to the estimate's
own estimate_uuid) so the existing Drive upload pipeline and photo viewer
work without changes.
"""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from app.db.session import Base


class Estimate(Base):
    __tablename__ = "estimates"

    id = Column(Integer, primary_key=True, index=True)

    # Offline-friendly client-generated UUID (used as job_uuid for photos)
    estimate_uuid = Column(String, unique=True, index=True, nullable=False)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    customer_name = Column(String, nullable=False)
    customer_email = Column(String, nullable=True)
    customer_phone = Column(String, nullable=True)

    origin_address = Column(String, nullable=True)
    destination_address = Column(String, nullable=True)

    move_date = Column(String, nullable=True)   # YYYY-MM-DD, blank = TBD

    origin_access_notes = Column(Text, nullable=True)  # stairs, parking, elevator
    destination_access_notes = Column(Text, nullable=True)
    special_items_notes = Column(Text, nullable=True)  # pianos, safes, art
    general_notes = Column(Text, nullable=True)

    # Estimated crew-hours for the move (admin-entered). The estimated side of
    # the Phase 4 est-vs-actual hours comparison. Nullable - blank until set.
    estimated_hours = Column(Float, nullable=True)

    # Link to the real job this estimate becomes: the canonical job_uuid the
    # crew uses (bound via the calendar job picker / resolveJobUuid). Lets the
    # crew app fetch this estimate's inventory + access notes for a job
    # (GET /api/estimates/by-job/{job_uuid}) - the basis for the Phase 5
    # overage comparison. Nullable + indexed; unlinked until an admin binds it.
    job_uuid = Column(String, nullable=True, index=True)

    # Rolled-up totals (recomputed on item add/remove)
    estimated_weight_lbs = Column(Float, nullable=False, default=0)
    estimated_cubic_ft = Column(Float, nullable=False, default=0)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    items = relationship(
        "EstimateItem",
        back_populates="estimate",
        cascade="all, delete-orphan",
        order_by="EstimateItem.id",
    )


class EstimateItem(Base):
    __tablename__ = "estimate_items"

    id = Column(Integer, primary_key=True, index=True)

    estimate_id = Column(Integer, ForeignKey("estimates.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String, nullable=False)
    qty = Column(Integer, nullable=False, default=1)
    weight_lbs = Column(Float, nullable=False, default=0)
    cubic_ft = Column(Float, nullable=False, default=0)
    # Room/subcategory let the estimator group inventory tile-style (e.g.
    # "Living Room" → "Going"/"Not Going")
    room = Column(String, nullable=True)
    subcategory = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    estimate = relationship("Estimate", back_populates="items")


class FurnitureCatalogItem(Base):
    """Admin-editable catalog of common furniture/items. Merges with the
    static FURNITURE_CATALOG on the frontend to power autocomplete."""

    __tablename__ = "furniture_catalog"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    weight_lbs = Column(Float, nullable=False, default=0)
    cubic_ft = Column(Float, nullable=False, default=0)
    category = Column(String, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False)
