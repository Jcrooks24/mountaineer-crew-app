"""
Job model.
Represents a moving job that crews can select.
"""

from sqlalchemy import Column, Integer, String, DateTime
from app.db.session import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)

    # Optional: external system id (e.g., SmartMoving quote/job id)
    external_job_id = Column(String, index=True, nullable=True)

    client_name = Column(String, index=True, nullable=False)

    origin_address = Column(String, nullable=True)
    destination_address = Column(String, nullable=True)

    # ISO-ish datetime stored as text by SQLite; SQLAlchemy handles mapping
    scheduled_start = Column(DateTime, nullable=True)
