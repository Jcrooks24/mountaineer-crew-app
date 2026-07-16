"""add overage_note to job_reports

Revision ID: a1b2c3d4e5f7
Revises: z0a1b2c3d4e5
Create Date: 2026-07-06

Phase 5: the crew's explanation when actual inventory runs over the linked
estimate (the overage conversation). Nullable Text; no backfill.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, Sequence[str], None] = 'z0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('overage_note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'overage_note')
