"""add estimated_hours + job_uuid link to estimates

Revision ID: y9z0a1b2c3d4
Revises: x8y9z0a1b2c3
Create Date: 2026-07-06

Phase 3: estimated crew-hours (the estimated side of est-vs-actual) and the
link from an estimate to the real job (canonical job_uuid), so the crew app
can fetch a job's estimate for the overage conversation. Both nullable so
pre-existing estimates need no backfill.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'y9z0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'x8y9z0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('estimates', sa.Column('estimated_hours', sa.Float(), nullable=True))
    op.add_column('estimates', sa.Column('job_uuid', sa.String(), nullable=True))
    op.create_index(op.f('ix_estimates_job_uuid'), 'estimates', ['job_uuid'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_estimates_job_uuid'), table_name='estimates')
    op.drop_column('estimates', 'job_uuid')
    op.drop_column('estimates', 'estimated_hours')
