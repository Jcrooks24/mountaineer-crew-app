"""add job_checklist_checks (C3.2)

Revision ID: a3c5e7f9b1d3
Revises: f2b4d6e8a0c1
Create Date: 2026-08-03

Manual tick state for the job checklist (C3). One row per (job_uuid, item_key).
Auto items are computed live from the job's artifacts and are not stored here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c5e7f9b1d3'
down_revision: Union[str, Sequence[str], None] = 'f2b4d6e8a0c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_checklist_checks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('item_key', sa.String(), nullable=False),
        sa.Column('checked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('checked_by_id', sa.Integer(), nullable=True),
        sa.Column('checked_by_name', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_uuid', 'item_key', name='uq_job_checklist_check'),
    )
    op.create_index('ix_job_checklist_checks_id', 'job_checklist_checks', ['id'])
    op.create_index('ix_job_checklist_checks_job_uuid', 'job_checklist_checks', ['job_uuid'])


def downgrade() -> None:
    op.drop_index('ix_job_checklist_checks_job_uuid', table_name='job_checklist_checks')
    op.drop_index('ix_job_checklist_checks_id', table_name='job_checklist_checks')
    op.drop_table('job_checklist_checks')
