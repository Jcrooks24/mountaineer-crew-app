"""add job_types table (admin-configurable job type tags)

Revision ID: c2e4f6a8b0d1
Revises: b1d3f5a7c9e2
Create Date: 2026-07-06

Seeds the eight previously-hardcoded job-type tags so existing reports keep
their vocabulary. Admin can add/rename/deactivate from Settings afterward.
"""
from typing import Sequence, Union
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision: str = 'c2e4f6a8b0d1'
down_revision: Union[str, Sequence[str], None] = 'b1d3f5a7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SEED = [
    "Local", "Long-distance", "Labor-only", "Packing",
    "Unpacking", "Commercial", "Delivery", "Storage",
]


def upgrade() -> None:
    op.create_table(
        "job_types",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False, unique=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    now = datetime.now(timezone.utc)
    op.bulk_insert(
        sa.table(
            "job_types",
            sa.column("name", sa.String),
            sa.column("sort_order", sa.Integer),
            sa.column("active", sa.Boolean),
            sa.column("created_at", sa.DateTime),
            sa.column("updated_at", sa.DateTime),
        ),
        [
            {"name": n, "sort_order": i, "active": True, "created_at": now, "updated_at": now}
            for i, n in enumerate(SEED)
        ],
    )


def downgrade() -> None:
    op.drop_table("job_types")
