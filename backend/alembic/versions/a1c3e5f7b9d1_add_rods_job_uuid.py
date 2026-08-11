"""add job_uuid (+ job_name) to rods_logs

Revision ID: a1c3e5f7b9d1
Revises: f0a2c4b6d8e0
Create Date: 2026-08-05

RodsLog was the only long-distance record missing a job link - its siblings
PriorOnDutyStatement and LdDay both carry a nullable job_uuid/job_name. The job
checklist's `rods` signal queried RodsLog.job_uuid and 500'd the whole
/job-checklist/{job}/status endpoint (AttributeError), which broke ALL auto-check
signals for every job. This adds the missing columns (nullable, so existing rows
are untouched). Populating them is the RODS recorder's job going forward.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5f7b9d1'
down_revision: Union[str, Sequence[str], None] = 'f0a2c4b6d8e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rods_logs', sa.Column('job_uuid', sa.String(), nullable=True))
    op.add_column('rods_logs', sa.Column('job_name', sa.String(), nullable=True))
    op.create_index('ix_rods_logs_job_uuid', 'rods_logs', ['job_uuid'])


def downgrade() -> None:
    op.drop_index('ix_rods_logs_job_uuid', table_name='rods_logs')
    op.drop_column('rods_logs', 'job_name')
    op.drop_column('rods_logs', 'job_uuid')
