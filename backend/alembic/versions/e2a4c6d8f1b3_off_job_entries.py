"""off_job_entries table (off-job hours logging)

Revision ID: e2a4c6d8f1b3
Revises: d1f3b5c7e9a2
Create Date: 2026-07-08

Hours for work done outside of any job: timeline stamps + hours + a
management-approved pay structure + a required note. Idempotent by entry_uuid.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2a4c6d8f1b3'
down_revision: Union[str, Sequence[str], None] = 'd1f3b5c7e9a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "off_job_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("entry_uuid", sa.String(), nullable=False, unique=True),
        sa.Column("submitted_by_id", sa.Integer(), nullable=True),
        sa.Column("submitted_by_name", sa.String(), nullable=True),
        sa.Column("work_date", sa.String(), nullable=True),
        sa.Column("start_time", sa.String(), nullable=True),
        sa.Column("end_time", sa.String(), nullable=True),
        sa.Column("hours", sa.Float(), nullable=False, server_default="0"),
        sa.Column("pay_structure", sa.String(), nullable=False, server_default="regular"),
        sa.Column("pay_other_note", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_off_job_entries_entry_uuid", "off_job_entries", ["entry_uuid"])


def downgrade() -> None:
    op.drop_index("ix_off_job_entries_entry_uuid", table_name="off_job_entries")
    op.drop_table("off_job_entries")
