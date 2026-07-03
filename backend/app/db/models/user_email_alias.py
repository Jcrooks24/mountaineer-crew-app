"""
UserEmailAlias model.

Crew members often have more than one email - a personal Gmail, a work
address, a long-running alias from before they joined. The Crew Resources
flow needs to match Google Calendar attendees back to the right user
regardless of which address the office used on the invite. Aliases live
here; the user's *primary* email stays on users.email so the rest of the
app (auth, password reset, Postmark sends, etc.) doesn't need to be
alias-aware.

Uniqueness rules:
- Each alias.email is unique across this table (no duplicate aliases).
- An alias.email must not collide with any users.email - enforced at
  the application layer by the admin endpoint (Postgres can't enforce
  cross-table uniqueness without a trigger we don't want to maintain).

Promote-to-primary swaps an alias with the user's current primary email
in a single transaction.
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from app.db.session import Base


class UserEmailAlias(Base):
    __tablename__ = "user_email_aliases"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Stored lowercase + stripped to match the normalization rule the
    # auth router applies to users.email - keeps the matching code in
    # crew_resources_calendar.py honest.
    email = Column(String, nullable=False, unique=True, index=True)

    created_at = Column(DateTime, nullable=False)
