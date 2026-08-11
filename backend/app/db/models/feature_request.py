"""
Feature request model.

Crew-suggested features or improvements: a short title, a description, and
optional screenshot Drive links. Keyed by a client-generated request_uuid for
idempotent offline submission (mirrors the bug-report pattern). Surfaced in the
nightly crew-feedback email and the FeatureRequests sheet tab.
"""

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.db.session import Base


class FeatureRequest(Base):
    __tablename__ = "feature_requests"

    id = Column(Integer, primary_key=True, index=True)

    # Client-generated UUID - idempotency key for the offline queue.
    request_uuid = Column(String, unique=True, index=True, nullable=False)

    # Short summary (optional) + the details.
    title = Column(String, nullable=True)
    description = Column(Text, nullable=False, default="")

    # JSON list of Google Drive URLs for any attached screenshots/mockups.
    screenshot_urls = Column(Text, nullable=False, default="[]")

    submitted_by_id = Column(Integer, nullable=True)
    submitted_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
