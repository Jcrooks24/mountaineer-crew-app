"""
Document Library - reference documents (COI, blank contract, BOL, estimate
templates, etc.) uploaded by admins for the crew to view or download.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from app.db.session import Base


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)

    title = Column(String, nullable=False)
    category = Column(String, nullable=False, default="general")
    filename = Column(String, nullable=False)
    mime_type = Column(String, nullable=False)

    drive_file_id = Column(String, nullable=False)
    drive_url = Column(String, nullable=False)

    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    uploaded_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
