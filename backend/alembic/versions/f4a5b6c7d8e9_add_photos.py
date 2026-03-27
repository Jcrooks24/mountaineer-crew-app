"""add photos table

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-03-27

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f4a5b6c7d8e9"
down_revision: Union[str, Sequence[str], None] = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("job_uuid", sa.String(), nullable=False, index=True),
        sa.Column("created_by", sa.String(), nullable=False, server_default=""),
        sa.Column("caption", sa.String(), nullable=False, server_default=""),
        sa.Column("drive_file_id", sa.String(), nullable=False),
        sa.Column("drive_url", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False, server_default="image/jpeg"),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    op.drop_table("photos")
