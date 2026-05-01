"""add logged_at to events

Revision ID: u9v0w1x2y3z4
Revises: t8u9v0w1x2y3
Create Date: 2026-05-01

Splits the single `timestamp` column into two:
- `logged_at` — immutable, the original device-capture time. Backfilled
  from `timestamp` for existing rows.
- `timestamp` — now user-editable; crew can correct the displayed event
  time on the timeline. Defaults to logged_at on insert.

The model docstring still calls `timestamp` "device time" — that comment
is updated separately on the application side. Old rows have logged_at ==
timestamp; new rows start the same way and only diverge after a user edit.
"""
from alembic import op
import sqlalchemy as sa


revision = 'u9v0w1x2y3z4'
down_revision = 't8u9v0w1x2y3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add nullable, backfill, then enforce NOT NULL — safe under concurrent
    # writes because /api/sync's INSERTs always populate `timestamp`, and
    # the new server code (released alongside this migration) sets
    # logged_at = timestamp on insert.
    op.add_column('events', sa.Column('logged_at', sa.DateTime(), nullable=True))
    op.execute("UPDATE events SET logged_at = timestamp WHERE logged_at IS NULL")
    op.alter_column('events', 'logged_at', nullable=False)


def downgrade() -> None:
    op.drop_column('events', 'logged_at')
