from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func
from app.db.session import Base


class Photo(Base):
    __tablename__ = "photos"

    id = Column(String, primary_key=True)          # device-generated UUID
    job_uuid = Column(String, nullable=False, index=True)
    created_by = Column(String, nullable=False, server_default="")
    caption = Column(String, nullable=False, server_default="")
    drive_file_id = Column(String, nullable=False)
    drive_url = Column(String, nullable=False)      # webViewLink
    mime_type = Column(String, nullable=False, server_default="image/jpeg")
    # Optional link to an incident this photo documents. incident_uuid is the
    # idempotency key of the incident; claim_number is denormalized for display
    # and so admin can find the photo in Drive by claim number.
    incident_uuid = Column(String, nullable=True, index=True)
    claim_number = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
