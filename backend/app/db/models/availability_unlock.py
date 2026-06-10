"""
AvailabilityUnlock model.

Admin-granted exception that lets a crew member edit a 14-day availability
window that would otherwise be locked (within 14 days of today + already
submitted). Crew member contacts the office; admin grants an unlock for the
specific (user, window_start); crew opens /availability and sees that window
become editable.

Unique on (user_id, window_start) so re-granting is idempotent — a second
admin clicking "unlock" for the same window doesn't pile up rows. Admin
revokes by DELETE — the unlock isn't auto-consumed by the crew's next
submission so the office stays in control of when the exception ends.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from app.db.session import Base


class AvailabilityUnlock(Base):
    __tablename__ = "availability_unlocks"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_name = Column(String, nullable=False)

    # Same shape as availability_days.window_start — first day of the
    # 14-day block the crew member is being allowed to edit.
    window_start = Column(String, nullable=False, index=True)

    # Who granted this. SET NULL on user delete so the audit trail survives
    # an account being removed; the cached granted_by_name keeps the row
    # human-readable in that case.
    granted_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    granted_by_name = Column(String, nullable=False)

    granted_at = Column(DateTime, nullable=False)

    # Free-text reason captured at grant time (e.g. "approved time-off
    # rescheduling per phone call"). Surfaces in the admin list view so
    # later audits don't require chasing context outside the app.
    note = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "window_start", name="uq_availability_unlocks_user_window"
        ),
    )
