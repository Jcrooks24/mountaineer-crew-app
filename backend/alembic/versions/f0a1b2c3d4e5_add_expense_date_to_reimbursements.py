"""add expense_date to reimbursements

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-06-10

Crew-entered "date of the actual expense/trip" — distinct from created_at,
which is when the submission was filed. Stored as a string in YYYY-MM-DD so
the format matches the rest of the date columns in this codebase (job_date,
trip_date, etc.). Nullable; older rows leave it null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursements', sa.Column('expense_date', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursements', 'expense_date')
