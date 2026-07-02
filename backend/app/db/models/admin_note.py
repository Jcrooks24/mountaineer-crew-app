"""Admin notes - admin-authored messages to crew, either global or scoped to
one job by job_uuid."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.session import Base


class AdminNote(Base):
    __tablename__ = "admin_notes"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)

    # NULL = global (applies to every crew member). Non-null = only surfaces
    # when that job is selected.
    job_uuid = Column(String, nullable=True, index=True)

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, index=True)
