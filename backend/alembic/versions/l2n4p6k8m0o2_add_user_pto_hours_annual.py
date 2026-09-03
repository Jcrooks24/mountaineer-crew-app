"""add users.pto_hours_annual

Somebody's annual PTO allowance, in hours, set by hand on the roster. It varies
per person and there is no accrual formula: the office decides a number.

Default 0, NOT NULL. Zero means "not eligible for PTO", which is deliberately the
same fact as "has no allowance" - a separate boolean flag alongside the number
would be two ways to say one thing, and they would eventually disagree.

Defaulting everyone to 0 is also the safe direction: nobody gains an allowance
they were not given, and the app refuses PTO until the office sets a number.

Revision ID: l2n4p6k8m0o2
Revises: k1m3o5j7l9n1
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'l2n4p6k8m0o2'
down_revision: Union[str, Sequence[str], None] = 'k1m3o5j7l9n1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('pto_hours_annual', sa.Float(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('users', 'pto_hours_annual')
