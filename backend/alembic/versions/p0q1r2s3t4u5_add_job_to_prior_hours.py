"""add job_uuid/job_name to prior_on_duty_statements

Revision ID: p0q1r2s3t4u5
Revises: o9p0q1r2s3t4
Create Date: 2026-07-01

Ties the Prior On-Duty statement to the trip's job so the LD report can tell
whether the PODS is done for THIS trip (instead of "any statement ever").
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p0q1r2s3t4u5'
down_revision: Union[str, Sequence[str], None] = 'o9p0q1r2s3t4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('prior_on_duty_statements', sa.Column('job_uuid', sa.String(), nullable=True))
    op.add_column('prior_on_duty_statements', sa.Column('job_name', sa.String(), nullable=True))
    op.create_index('ix_prior_on_duty_statements_job_uuid', 'prior_on_duty_statements', ['job_uuid'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_prior_on_duty_statements_job_uuid', table_name='prior_on_duty_statements')
    op.drop_column('prior_on_duty_statements', 'job_name')
    op.drop_column('prior_on_duty_statements', 'job_uuid')
