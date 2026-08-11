"""add job_setup header table (C1.1, ADR 0034)

Revision ID: f2b4d6e8a0c1
Revises: e1a3c5d7f9b2
Create Date: 2026-08-03

The first real top-level "job object": one row per job_uuid holding the job
header (crew, vehicle units, local/long-distance, job type, addresses) that the
capture screen sets and the other tools seed from. Purely additive - nothing
reads it yet, and a job with no header falls back to today's behavior.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2b4d6e8a0c1'
down_revision: Union[str, Sequence[str], None] = 'e1a3c5d7f9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_setup',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('job_date', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('calendar_event_id', sa.String(), nullable=True),
        sa.Column('is_long_distance', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('job_type_tags', sa.Text(), nullable=True),
        sa.Column('vehicle_unit_names', sa.Text(), nullable=True),
        sa.Column('crew_json', sa.Text(), nullable=True),
        sa.Column('origin', sa.String(), nullable=True),
        sa.Column('destination', sa.String(), nullable=True),
        sa.Column('stops_json', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('locked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('updated_by_id', sa.Integer(), nullable=True),
        sa.Column('updated_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_setup_id', 'job_setup', ['id'])
    op.create_index('ix_job_setup_job_uuid', 'job_setup', ['job_uuid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_job_setup_job_uuid', table_name='job_setup')
    op.drop_index('ix_job_setup_id', table_name='job_setup')
    op.drop_table('job_setup')
