"""add payment_method to reimbursements

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-05-15

Distinguishes a personal-card expense (crew wants reimbursement) from a
company-card expense (log only — no money owed back). Nullable; mileage
rows leave it null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6c7d8e9f0a1'
down_revision: Union[str, Sequence[str], None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursements', sa.Column('payment_method', sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursements', 'payment_method')
