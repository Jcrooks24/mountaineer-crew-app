"""add users.is_crew_lead (admin-set skill-rating designation)

Revision ID: f3b5d7a9c1e2
Revises: e2a4c6d8f1b3
Create Date: 2026-07-09

An admin-set flag that gates who can view + fill out per-employee skill
ratings on the Job Report, independent of the `crew_lead` role (which also
grants report finish/submit powers). Defaults false so existing crew are
unaffected until an admin designates them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b5d7a9c1e2'
down_revision: Union[str, Sequence[str], None] = 'e2a4c6d8f1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_crew_lead", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("users", "is_crew_lead")
