"""add scheduled_start/scheduled_end to calendar_jobs

Revision ID: z0a1b2c3d4e5
Revises: y9z0a1b2c3d4
Create Date: 2026-07-06

Phase 4 (fallback): cache the calendar event's scheduled window on the
calendar_jobs row at resolve time, so the server can compute a
scheduled-duration baseline for est-vs-actual hours without a live Calendar
API call. Nullable - older rows and manual jobs have no window.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'z0a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'y9z0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('calendar_jobs', sa.Column('scheduled_start', sa.String(), nullable=True))
    op.add_column('calendar_jobs', sa.Column('scheduled_end', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('calendar_jobs', 'scheduled_end')
    op.drop_column('calendar_jobs', 'scheduled_start')
