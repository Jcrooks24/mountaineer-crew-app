"""add job_type_tags_json and truck_fullness_json to job_reports

Revision ID: w7x8y9z0a1b2
Revises: v6w7x8y9z0a1
Create Date: 2026-07-06

Phase 1 close-out enrichment: persists the multi-select job-type tags and the
per-truck fullness readings collected on the Report tab. Both stored as JSON
text (matching the employee_hours_json pattern). Nullable so pre-existing rows
read as empty without a backfill. Per-employee skill_rating rides inside the
existing employee_hours_json and needs no column.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'w7x8y9z0a1b2'
down_revision: Union[str, Sequence[str], None] = 'v6w7x8y9z0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('job_type_tags_json', sa.Text(), nullable=True))
    op.add_column('job_reports', sa.Column('truck_fullness_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'truck_fullness_json')
    op.drop_column('job_reports', 'job_type_tags_json')
