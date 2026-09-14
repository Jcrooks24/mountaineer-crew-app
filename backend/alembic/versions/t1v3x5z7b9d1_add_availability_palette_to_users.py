"""add availability_palette to users

Revision ID: t1v3x5z7b9d1
Revises: s9u1w3r5t7v9
Create Date: 2026-09-14

A crew member's colorblind-friendly palette for their own Availability tools.
Stored on the account rather than the phone so it follows them to a new or
replacement device, and so an admin opening that person's availability never
picks it up. See ADR 0050.

server_default 'default' backfills every existing row to the conventional
green / red / amber, which is exactly what they see today.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't1v3x5z7b9d1'
down_revision: Union[str, Sequence[str], None] = 's9u1w3r5t7v9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(
            sa.Column('availability_palette', sa.String(), nullable=False, server_default='default')
        )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('availability_palette')
