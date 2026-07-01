"""add long_distance_days table

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-07-01

Per-diem / drive-day tracking for long-distance trips. One row per driver per
day (upserted by driver+date): out_of_town drives the $50/day per-diem tally
and drive_day is counted for fixed drive-pay reminders. Admin reads the totals
off the LongDistancePay sheet.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n8o9p0q1r2s3'
down_revision: Union[str, Sequence[str], None] = 'm7n8o9p0q1r2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'long_distance_days',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('day_id', sa.String(), nullable=False),
        sa.Column('driver_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('driver_name', sa.String(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('date', sa.String(), nullable=False),
        sa.Column('out_of_town', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('drive_day', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_long_distance_days_day_id', 'long_distance_days', ['day_id'], unique=True)
    op.create_index('ix_long_distance_days_job_uuid', 'long_distance_days', ['job_uuid'], unique=False)
    op.create_index('ix_long_distance_days_date', 'long_distance_days', ['date'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_long_distance_days_date', table_name='long_distance_days')
    op.drop_index('ix_long_distance_days_job_uuid', table_name='long_distance_days')
    op.drop_index('ix_long_distance_days_day_id', table_name='long_distance_days')
    op.drop_table('long_distance_days')
