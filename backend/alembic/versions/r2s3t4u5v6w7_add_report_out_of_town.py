"""add out_of_town to job_reports

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-07-02

Report-level "started and ended the day out of town" flag -> $50/day per-diem.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'r2s3t4u5v6w7'
down_revision: Union[str, Sequence[str], None] = 'q1r2s3t4u5v6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('out_of_town', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'out_of_town')
