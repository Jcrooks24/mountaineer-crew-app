"""calendar_jobs invitee_count for man-hours schedule fallback

Revision ID: b8d1f2a4c6e3
Revises: a7c9e1f3b5d2
Create Date: 2026-07-08

Caches the number of invited crew on a calendar event so the est-vs-actual
scheduled-duration fallback can express estimated man-hours (invitees x duration)
rather than raw wall-clock duration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d1f2a4c6e3'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1f3b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("calendar_jobs", sa.Column("invitee_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("calendar_jobs", "invitee_count")
