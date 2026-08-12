"""Patch notes - admin-authored changelog entries shown to all crew."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.session import Base


class PatchNote(Base):
    __tablename__ = "patch_notes"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)

    # The build this note describes, if an admin linked one. Free-text rather
    # than a foreign key: a note can be written for a build before any device has
    # reported it, and refusing to save the link until someone loads that build
    # would be the tail wagging the dog. The history joins on it by value and
    # renders an unmatched link as a note with no build, which is the truth.
    build_id = Column(String, nullable=True, index=True)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, index=True)
