"""add crew_feedback fields to job_reports

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-06-10

Adds the Report-tab "general feedback / about this job" question. Two columns
so the Yes/No answer is captured separately from the free-text body — a "No"
should not lose information just because the textarea is empty.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('has_crew_feedback', sa.Boolean(), nullable=True))
    op.add_column('job_reports', sa.Column('crew_feedback', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'crew_feedback')
    op.drop_column('job_reports', 'has_crew_feedback')
