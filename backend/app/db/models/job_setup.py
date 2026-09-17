"""
JobSetup model - the top-level header for a job (ADR 0034).

One row per job_uuid, holding the facts that describe a job as a whole and used
to seed the other tools: crew, vehicle unit(s), local/long-distance, job type,
addresses. This is the first real "job object"; everything else is still keyed by
job_uuid and reads this as its default.

JSON columns (crew, tags, units, stops) follow the same pattern as the job
report's employee_hours_json: a per-job list with no row identity of its own.
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from app.db.session import Base


class JobSetup(Base):
    __tablename__ = "job_setup"

    id = Column(Integer, primary_key=True, index=True)

    # The job identity. One header per job.
    job_uuid = Column(String, unique=True, index=True, nullable=False)

    # Denormalized name/date (same convention as every other per-job table). The
    # header is the authoritative copy the capture screen sets.
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)  # YYYY-MM-DD

    # How the job was identified. "calendar" carries the event id; "manual" does
    # not. Mirrors the client's JobMeta.source.
    source = Column(String, nullable=True)
    calendar_event_id = Column(String, nullable=True)

    # Long-distance is a property of the JOB now, not the device (ADR 0034). The
    # device mode toggle becomes the fallback for a job with no header.
    is_long_distance = Column(Boolean, nullable=False, default=False)

    # JSON list[str] of job-type tag names (mirrors the report's tags).
    job_type_tags = Column(Text, nullable=True)
    # JSON list[str] of vehicle unit names from the fleet registry.
    vehicle_unit_names = Column(Text, nullable=True)

    # JSON dict identifying the ACTUAL rented truck, when one of the selected
    # units is a rental placeholder: {company, agreement_number, plate,
    # gvwr_lbs, notes}. A registry entry named "rental" is reused across every
    # truck we ever hire, so without this nothing in the app says which physical
    # vehicle a DVIR, a duty log or a bill of lading describes, and nothing
    # records the weight rating that decides whether federal rules reached the
    # trip at all. The DVIR snapshots these onto its own row rather than
    # pointing here, because a report must stay true to the truck it inspected
    # even if the header is later edited. See ADR 0053.
    rental_json = Column(Text, nullable=True)
    # JSON list[{user_id, name, source: "invitee"|"added", confirmed: bool}].
    # Crew are interpolated from the calendar invitees then confirmed/added.
    crew_json = Column(Text, nullable=True)

    origin = Column(String, nullable=True)
    destination = Column(String, nullable=True)
    # JSON list[str] of intermediate stops (blank OK).
    stops_json = Column(Text, nullable=True)

    # JSON dict of the long-distance Bill of Lading shipment header (the FMCSA
    # 375.505 fields not already on this row: shipper name/phone/address, form of
    # payment, valuation, agreed pickup/delivery, etc.). Seeds the BOL blank-only.
    bol_header_json = Column(Text, nullable=True)

    notes = Column(Text, nullable=True)

    # Overwrite protection (C2). Once set, editing the header is a deliberate act
    # because it now feeds other tools. The write path refuses to change a locked
    # header without an explicit override.
    locked = Column(Boolean, nullable=False, default=False)

    created_by_id = Column(Integer, nullable=True)
    created_by_name = Column(String, nullable=True)
    updated_by_id = Column(Integer, nullable=True)
    updated_by_name = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
