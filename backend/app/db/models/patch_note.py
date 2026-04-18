"""Patch notes — admin-authored changelog entries shown to all crew."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.session import Base


class PatchNote(Base):
    __tablename__ = "patch_notes"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, index=True)
