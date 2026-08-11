"""add bug_reports table

Revision ID: c8d0e2f4a6b8
Revises: e6f8a0b2c4d5
Create Date: 2026-08-03

New table for the Report a Bug feature. Crew submits an app bug with a
description, the date it occurred, and screenshot Drive links. One row per
report, identified by bug_uuid (offline-idempotency key). Surfaced in the
nightly crew-feedback email and the Bugs sheet tab.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8d0e2f4a6b8'
down_revision: Union[str, Sequence[str], None] = 'e6f8a0b2c4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bug_reports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('bug_uuid', sa.String(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('occurred_date', sa.String(), nullable=True),
        sa.Column('screenshot_urls', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('submitted_by_id', sa.Integer(), nullable=True),
        sa.Column('submitted_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_bug_reports_bug_uuid', 'bug_reports', ['bug_uuid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_bug_reports_bug_uuid', table_name='bug_reports')
    op.drop_table('bug_reports')
