"""add incident tracking fields (status, settled_amount, conversation_log)

Revision ID: d9e1f3a5b7c9
Revises: c8d0e2f4a6b8
Create Date: 2026-08-03

Admin incident tracking: a workflow `status` (no status / pending / resolved),
the dollars actually `settled_amount` on the claim, and a JSON `conversation_log`
of notes about internal / client conversations. Backfills status from the
existing `resolved` boolean.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd9e1f3a5b7c9'
down_revision: Union[str, Sequence[str], None] = 'c8d0e2f4a6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('incidents', sa.Column('status', sa.String(), nullable=True))
    op.add_column('incidents', sa.Column('settled_amount', sa.Float(), nullable=True))
    op.add_column('incidents', sa.Column('conversation_log', sa.Text(), nullable=True))
    # Seed status from the existing resolved flag so the tracker starts coherent.
    op.execute("UPDATE incidents SET status = 'resolved' WHERE resolved = true")


def downgrade() -> None:
    op.drop_column('incidents', 'conversation_log')
    op.drop_column('incidents', 'settled_amount')
    op.drop_column('incidents', 'status')
