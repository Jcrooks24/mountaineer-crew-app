"""sheet_sync_status table for the Advanced Settings health check

Revision ID: c9e2a4b6d8f1
Revises: b8d1f2a4c6e3
Create Date: 2026-07-08

Tracks the last success/failure per sheet export function so the system check
can flag a silently-failing sync.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9e2a4b6d8f1'
down_revision: Union[str, Sequence[str], None] = 'b8d1f2a4c6e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sheet_sync_status",
        sa.Column("fn_name", sa.String(), primary_key=True),
        sa.Column("last_ok_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sheet_sync_status")
