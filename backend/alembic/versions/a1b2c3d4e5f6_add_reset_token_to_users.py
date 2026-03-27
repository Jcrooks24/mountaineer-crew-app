"""add reset_token to users

Revision ID: a1b2c3d4e5f6
Revises: 963ea614f493
Create Date: 2026-03-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '963ea614f493'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("reset_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("reset_token_expiry", sa.DateTime(), nullable=True))
    op.create_index("ix_users_reset_token", "users", ["reset_token"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_users_reset_token", table_name="users")
    op.drop_column("users", "reset_token_expiry")
    op.drop_column("users", "reset_token")
