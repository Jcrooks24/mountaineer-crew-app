"""add materials_submissions table

Revision ID: g5h6i7j8k9l0
Revises: f4a5b6c7d8e9
Create Date: 2026-03-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g5h6i7j8k9l0'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "materials_submissions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("submission_id", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("job_uuid", sa.String(), nullable=False, index=True),
        sa.Column("job_label", sa.String(), nullable=True),
        sa.Column("job_name", sa.String(), nullable=True),
        sa.Column("job_date", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("items_json", sa.String(), nullable=False, server_default="[]"),
        sa.Column("total", sa.Float(), nullable=False, server_default="0.0"),
    )


def downgrade() -> None:
    op.drop_table("materials_submissions")
