"""add scheduling_notes to users

Revision ID: l6g7h8i9j0k1
Revises: k5f6g7h8i9j0
Create Date: 2026-06-16

Persistent per-crew text field shown alongside the availability picker.
One note per user, independent of any window — the crew use it to flag
ongoing constraints ("only mornings until July", "no Saturdays", etc.).
Surfaced to admin via a hover tooltip on the monthly availability view.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l6g7h8i9j0k1'
down_revision: Union[str, Sequence[str], None] = 'k5f6g7h8i9j0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default="" so existing rows backfill to empty (NOT NULL safe)
    # without a manual UPDATE step. We treat empty string and NULL the same
    # everywhere downstream, so making it NOT NULL keeps the read path simple.
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(
            sa.Column('scheduling_notes', sa.Text(), nullable=False, server_default='')
        )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_column('scheduling_notes')
