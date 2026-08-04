"""add feature_requests

Revision ID: c5e7f9b1d3a5
Revises: b4d6f8a0c2e4
Create Date: 2026-08-04

Crew feature/improvement suggestions (parallel to bug_reports): title +
description + optional screenshot Drive links, keyed by a client request_uuid
for idempotent offline submission.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5e7f9b1d3a5'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'feature_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('request_uuid', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=True),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('screenshot_urls', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('submitted_by_id', sa.Integer(), nullable=True),
        sa.Column('submitted_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_feature_requests_id', 'feature_requests', ['id'])
    op.create_index('ix_feature_requests_request_uuid', 'feature_requests', ['request_uuid'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_feature_requests_request_uuid', table_name='feature_requests')
    op.drop_index('ix_feature_requests_id', table_name='feature_requests')
    op.drop_table('feature_requests')
