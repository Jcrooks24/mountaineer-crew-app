"""
Incident model.

Crew-reported incidents (damage, injury, near-miss) logged from the job flow.
Mirrors the skills-tracker Incidents tab: attributed crew member, severity,
attributability, description, estimated cost, resolution, notes. Keyed by a
client-generated incident_uuid for idempotent offline submission.
"""

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text
from app.db.session import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)

    # Client-generated UUID - idempotency key for the offline queue.
    incident_uuid = Column(String, unique=True, index=True, nullable=False)

    # Human-readable claim number (e.g. "MC-20260707-4F2A"). Generated on the
    # device at submit so it's available offline and stable across syncs.
    claim_number = Column(String, nullable=True)

    # Universal job key (may be blank if reported outside a job).
    job_uuid = Column(String, index=True, nullable=True)
    job_name = Column(String, nullable=True)

    # When the incident happened (YYYY-MM-DD, crew-entered; defaults to today).
    incident_date = Column(String, nullable=True)

    reported_by_id = Column(Integer, nullable=True)
    reported_by_name = Column(String, nullable=True)

    # Crew member the incident is attributed to (roster name, or "Unknown /
    # Crew" when attribution is unclear).
    attributed_crew = Column(String, nullable=True)

    # "minor" | "moderate" | "major"
    severity = Column(String, nullable=False, default="minor")
    # "yes" | "no" | "unknown"
    attributable = Column(String, nullable=False, default="unknown")

    description = Column(Text, nullable=False, default="")
    est_cost = Column(Float, nullable=True)
    resolved = Column(Boolean, nullable=False, default=False)
    notes = Column(Text, nullable=True)

    # JSON array of Drive photo URLs attached at submit time (online only).
    photo_urls = Column(Text, nullable=False, default="[]")

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
