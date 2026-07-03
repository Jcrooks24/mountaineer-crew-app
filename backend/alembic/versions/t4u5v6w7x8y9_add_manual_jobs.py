"""add manual_jobs

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-07-03

Manual job entries typed into "Other (enter manually)" on the Timeline.
Persisted so the entry shows up in other crew members' dropdowns for the
same day and so the same manual name resolves to the same job_uuid across
devices (the client derives job_uuid deterministically from name + date).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't4u5v6w7x8y9'
down_revision: Union[str, Sequence[str], None] = 's3t4u5v6w7x8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'manual_jobs',
        sa.Column('job_uuid', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('job_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.UniqueConstraint('name', 'job_date', name='uq_manual_jobs_name_date'),
    )
    op.create_index('ix_manual_jobs_job_uuid', 'manual_jobs', ['job_uuid'], unique=False)
    op.create_index('ix_manual_jobs_job_date', 'manual_jobs', ['job_date'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_manual_jobs_job_date', table_name='manual_jobs')
    op.drop_index('ix_manual_jobs_job_uuid', table_name='manual_jobs')
    op.drop_table('manual_jobs')
