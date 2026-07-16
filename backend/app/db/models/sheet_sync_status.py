"""Last-run status per sheet export function.

One row per export function name (e.g. "export_events_to_sheets"). Updated
best-effort at the central export chokepoint so the Advanced Settings system
check can show which sheet syncs are healthy and which last failed.
"""

from sqlalchemy import Column, String, DateTime, Text
from app.db.session import Base


class SheetSyncStatus(Base):
    __tablename__ = "sheet_sync_status"

    fn_name = Column(String, primary_key=True)
    last_ok_at = Column(DateTime, nullable=True)
    last_error_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
