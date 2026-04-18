"""add job_reports table

Revision ID: j8k9l0m1n2o3
Revises: i7j8k9l0m1n2
Create Date: 2026-04-16 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j8k9l0m1n2o3'
down_revision: Union[str, Sequence[str], None] = 'i7j8k9l0m1n2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('submitted_by_id', sa.Integer(), nullable=True),
        sa.Column('submitted_by_name', sa.String(), nullable=True),
        sa.Column('personal_vehicles', sa.Integer(), nullable=False),
        sa.Column('dumpster_pct', sa.Integer(), nullable=False),
        sa.Column('recycling_pct', sa.Integer(), nullable=False),
        sa.Column('billing_method', sa.String(), nullable=False),
        sa.Column('review_candidate', sa.Boolean(), nullable=True),
        sa.Column('hours_match', sa.Boolean(), nullable=True),
        sa.Column('hours_mismatch_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_job_reports_id'), 'job_reports', ['id'], unique=False)
    op.create_index(op.f('ix_job_reports_job_uuid'), 'job_reports', ['job_uuid'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_job_reports_job_uuid'), table_name='job_reports')
    op.drop_index(op.f('ix_job_reports_id'), table_name='job_reports')
    op.drop_table('job_reports')
