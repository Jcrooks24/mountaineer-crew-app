"""
User model for authentication.
Minimal fields for now + minimal RBAC stub.
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)

    # New fields (Phase A / Track 2)
    name = Column(String, nullable=True)
    # Contact phone (roster config); surfaced on the admin scheduling header.
    phone = Column(String, nullable=True)
    role = Column(String, nullable=False, default="user")

    is_active = Column(Boolean, default=True, nullable=False)

    # Admin-set flag: may this user view + fill out the job type and the
    # per-employee skill ratings on the Job Report? Independent of `role` - the
    # crew_lead role does NOT grant it (ADR 0014), so rating stays a small,
    # explicitly designated group. Defaults false.
    is_skill_rater = Column(Boolean, nullable=False, server_default="false", default=False)

    # Password reset
    reset_token = Column(String, nullable=True, index=True)
    reset_token_expiry = Column(DateTime(timezone=True), nullable=True)

    # Profile photo - resized ~256px data URL (image/jpeg), shared across devices
    profile_photo = Column(Text, nullable=True)

    # Free-form scheduling notes the crew maintains on their availability page.
    # One note per user, persists across windows. Surfaced as a hover tooltip
    # on the admin monthly availability view. NOT NULL with empty default so
    # the read path doesn't need to handle Optional[str].
    scheduling_notes = Column(Text, nullable=False, server_default="", default="")
