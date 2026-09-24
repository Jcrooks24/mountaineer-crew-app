"""
Rental truck records (ADR 0055).

A fleet-registry entry flagged `is_rental` is a PLACEHOLDER that stands for
whatever truck was hired (ADR 0053). A RentalTruck is one of those actual trucks:
its plate, company, agreement number and GVWR, entered once by whoever has it in
front of them (usually at the pre-trip DVIR), and then offered in the truck list
as "Rental*<job name>" so a multi-day job does not re-enter it.

One truck can serve more than one job. Each job it served is a RentalTruckJob
row, so the record shows every job the truck was linked to and when.

Keyed by a client-generated `rental_uuid` so an offline job-setup save can carry
a new truck and retry safely.
"""

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from app.db.session import Base


class RentalTruck(Base):
    __tablename__ = "rental_trucks"

    id = Column(Integer, primary_key=True, index=True)
    rental_uuid = Column(String, unique=True, index=True, nullable=False)

    # The registry placeholder this truck stands behind ("RENTAL"). A DVIR filed
    # on this truck stores it as `vehicle_number`, with the plate as
    # `vehicle_identifier`, so the ADR 0053 prior-report scoping still applies.
    unit_name = Column(String, nullable=False)

    # The plate or unit number as typed, and a normalized key for matching
    # ("MT 4B-123" and "mt4b123" are the same truck).
    plate = Column(String, nullable=False)
    plate_key = Column(String, index=True, nullable=False)

    company = Column(String, nullable=True)
    agreement_number = Column(String, nullable=True)
    gvwr_lbs = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    created_by_id = Column(Integer, nullable=True)
    created_by_name = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)

    # Moved forward on every inspection and every job link. The truck list hides
    # a rental 10 days after this, so a truck nobody marked returned does not sit
    # in the list forever.
    last_used_at = Column(DateTime, index=True, nullable=False)

    # Set when crew or admin mark the truck handed back. Hides it from the list;
    # the record and its history stay.
    returned_at = Column(DateTime, nullable=True)
    returned_by_name = Column(String, nullable=True)


class RentalTruckJob(Base):
    """One job a rental truck served. A truck used on two jobs has two rows."""

    __tablename__ = "rental_truck_jobs"
    __table_args__ = (
        UniqueConstraint("rental_uuid", "job_uuid", name="uq_rental_truck_jobs_rental_job"),
    )

    id = Column(Integer, primary_key=True, index=True)
    rental_uuid = Column(String, index=True, nullable=False)
    job_uuid = Column(String, index=True, nullable=False)
    # Snapshot at link time. The label prefers the job header's current name.
    job_name = Column(String, nullable=True)
    job_date = Column(String, nullable=True)
    # "dvir" | "job_setup": where the link was made.
    source = Column(String, nullable=True)
    linked_by_id = Column(Integer, nullable=True)
    linked_by_name = Column(String, nullable=True)
    linked_at = Column(DateTime, nullable=False)
