"""
DqDocument model (C4).

One row per (driver, doc_type): the MOST RECENT document of that type for that
driver. A new upload/submission replaces the row in place (and the old Drive
file is deleted), so the app always holds exactly the current copy - the DQ file
rule. The type catalog lives in SystemConfig (core/dq_doc_types.py); this table
is the driver's actual documents.
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from app.db.session import Base


class DqDocument(Base):
    __tablename__ = "dq_documents"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # The doc-type key from the catalog (core/dq_doc_types.py).
    doc_type = Column(String, nullable=False)
    # Name snapshot at submit time, so the row still reads sensibly if the
    # catalog entry is later renamed or removed.
    doc_name = Column(String, nullable=True)

    # Where the file lives in Drive.
    drive_file_id = Column(String, nullable=True)
    drive_url = Column(String, nullable=True)
    filename = Column(String, nullable=True)

    # "submitted" once a file is present. Reserved for future states (e.g. an
    # admin-reviewed flag) without a migration churn.
    status = Column(String, nullable=False, default="submitted")

    submitted_by_id = Column(Integer, nullable=True)
    submitted_by_name = Column(String, nullable=True)
    submitted_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "doc_type", name="uq_dq_document_user_type"),
    )
