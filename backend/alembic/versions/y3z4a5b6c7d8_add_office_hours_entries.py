"""add office_hours_entries table

Revision ID: y3z4a5b6c7d8
Revises: x2y3z4a5b6c7
Create Date: 2026-05-14

New table for the Office Hours feature. Admins log office-staff hours that
aren't tied to a job. One row per submission; entry_uuid is the offline-
idempotency key (same pattern as materials_submissions.submission_id and
estimates.estimate_uuid).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'y3z4a5b6c7d8'
down_revision: Union[str, Sequence[str], None] = 'x2y3z4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'office_hours_entries',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('entry_uuid', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('work_date', sa.String(), nullable=False),
        sa.Column('start_time', sa.String(), nullable=False),
        sa.Column('end_time', sa.String(), nullable=False),
        sa.Column('break_hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('hours', sa.Float(), nullable=False, server_default='0'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'ix_office_hours_entries_entry_uuid',
        'office_hours_entries',
        ['entry_uuid'],
        unique=True,
    )
    op.create_index(
        'ix_office_hours_entries_work_date',
        'office_hours_entries',
        ['work_date'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_office_hours_entries_work_date', table_name='office_hours_entries')
    op.drop_index('ix_office_hours_entries_entry_uuid', table_name='office_hours_entries')
    op.drop_table('office_hours_entries')
