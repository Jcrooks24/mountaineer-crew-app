"""add incidents table

Revision ID: e4a6c8b0d2f3
Revises: d3f5a7b9c1e2
Create Date: 2026-07-06

Crew-reported incidents logged from the job flow.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4a6c8b0d2f3'
down_revision: Union[str, Sequence[str], None] = 'd3f5a7b9c1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "incidents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("incident_uuid", sa.String(), nullable=False, unique=True),
        sa.Column("job_uuid", sa.String(), nullable=True),
        sa.Column("job_name", sa.String(), nullable=True),
        sa.Column("incident_date", sa.String(), nullable=True),
        sa.Column("reported_by_id", sa.Integer(), nullable=True),
        sa.Column("reported_by_name", sa.String(), nullable=True),
        sa.Column("attributed_crew", sa.String(), nullable=True),
        sa.Column("severity", sa.String(), nullable=False, server_default="minor"),
        sa.Column("attributable", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("est_cost", sa.Float(), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("photo_urls", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_incidents_incident_uuid", "incidents", ["incident_uuid"])
    op.create_index("ix_incidents_job_uuid", "incidents", ["job_uuid"])


def downgrade() -> None:
    op.drop_index("ix_incidents_job_uuid", table_name="incidents")
    op.drop_index("ix_incidents_incident_uuid", table_name="incidents")
    op.drop_table("incidents")
