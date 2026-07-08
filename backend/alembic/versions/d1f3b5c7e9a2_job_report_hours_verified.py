"""job_reports hours_verified (crew-lead sign-off)

Revision ID: d1f3b5c7e9a2
Revises: c9e2a4b6d8f1
Create Date: 2026-07-08

Crew-lead confirmation that the per-employee hours on a job report are correct.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd1f3b5c7e9a2'
down_revision: Union[str, Sequence[str], None] = 'c9e2a4b6d8f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_reports", sa.Column("hours_verified", sa.Boolean(), nullable=True, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("job_reports", "hours_verified")
