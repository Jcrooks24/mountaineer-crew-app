"""add vendor to reimbursements

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-05-15

Free-text vendor (store/business) for expense rows so admin can see where
a purchase was made. Nullable; mileage rows leave it null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursements', sa.Column('vendor', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursements', 'vendor')
