"""add phone to users

Revision ID: q1r2s3t4u5v6
Revises: p0q1r2s3t4u5
Create Date: 2026-07-02

Contact phone for the roster; shown on the admin scheduling header.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'q1r2s3t4u5v6'
down_revision: Union[str, Sequence[str], None] = 'p0q1r2s3t4u5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('phone', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'phone')
