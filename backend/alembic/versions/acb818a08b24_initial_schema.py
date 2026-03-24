"""initial schema

Revision ID: acb818a08b24
Revises:
Create Date: 2026-02-19 17:19:14.879570

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'acb818a08b24'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("email", sa.String(), nullable=False, index=True, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("external_job_id", sa.String(), nullable=True, index=True),
        sa.Column("client_name", sa.String(), nullable=False, index=True),
        sa.Column("origin_address", sa.String(), nullable=True),
        sa.Column("destination_address", sa.String(), nullable=True),
        sa.Column("scheduled_start", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "events",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("event_id", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("job_uuid", sa.String(), nullable=True, index=True),
        sa.Column("job_id", sa.Integer(), sa.ForeignKey("jobs.id"), nullable=True, index=True),
        sa.Column("type", sa.String(), nullable=False, index=True),
        sa.Column("timestamp", sa.DateTime(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("synced", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "sheet_event_exports",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column("exported_at", sa.Text(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
    )

    op.create_table(
        "sheet_material_exports",
        sa.Column("export_key", sa.Text(), primary_key=True),
        sa.Column("exported_at", sa.Text(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    op.drop_table("sheet_material_exports")
    op.drop_table("sheet_event_exports")
    op.drop_table("events")
    op.drop_table("jobs")
    op.drop_table("users")
