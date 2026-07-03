"""
OfficeHoursEntry model.

Office staff (admins) log a day's worked hours that aren't tied to any
specific crew job. Mirrors the JobReport per-employee hours shape (HH:MM
start/end + break) so the same time-math logic can be reused on both sides
of the app.

One row per (user, work_date, entry_uuid). entry_uuid is generated on the
device so offline-queued submissions are idempotent - duplicate posts hit
the unique index and are silently no-op'd (same pattern as
materials_submissions.submission_id).
"""

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from app.db.session import Base


class OfficeHoursEntry(Base):
    __tablename__ = "office_hours_entries"

    id = Column(Integer, primary_key=True, index=True)

    # Device-generated UUID - used for idempotent upserts.
    entry_uuid = Column(String, unique=True, index=True, nullable=False)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_name = Column(String, nullable=False)

    # Day the work was performed (stored as ISO YYYY-MM-DD). Kept as a
    # string to match the rest of the codebase's "stringy date" pattern
    # (job_date on MaterialsSubmission etc.) and to dodge timezone math
    # when an admin in MT logs hours from a laptop set to UTC.
    work_date = Column(String, nullable=False, index=True)

    # Wall-clock times as HH:MM (same shape as employee_hours_json entries
    # in job_reports.employee_hours_json). Stored as strings rather than
    # Time columns so partial entries (e.g. "still working") can persist
    # without forcing a sentinel.
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)

    break_hours = Column(Float, nullable=False, default=0.0)

    # Net billable hours after the break, snapped to the company quarter-hour
    # rule. Stored so the sheet doesn't need to re-derive on read and so a
    # later UI tweak to the rounding doesn't silently rewrite history.
    hours = Column(Float, nullable=False, default=0.0)

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)
