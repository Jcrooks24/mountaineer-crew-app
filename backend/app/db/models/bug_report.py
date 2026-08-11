"""
Bug report model.

Crew-reported app bugs: a description, the date it occurred, and screenshot
Drive links. Keyed by a client-generated bug_uuid for idempotent offline
submission (mirrors the incident pattern). Surfaced in the nightly
crew-feedback email and the Bugs sheet tab.
"""

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.db.session import Base


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True, index=True)

    # Client-generated UUID - idempotency key for the offline queue.
    bug_uuid = Column(String, unique=True, index=True, nullable=False)

    description = Column(Text, nullable=False, default="")
    # YYYY-MM-DD the bug was observed (crew-entered; defaults to today client-side).
    occurred_date = Column(String, nullable=True)

    # JSON list of Google Drive URLs for the attached screenshots.
    screenshot_urls = Column(Text, nullable=False, default="[]")

    submitted_by_id = Column(Integer, nullable=True)
    submitted_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
