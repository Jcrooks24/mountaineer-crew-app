"""add availability_unlocks table

Revision ID: j4e5f6g7h8i9
Revises: i3d4e5f6g7h8
Create Date: 2026-06-10

Admin-granted exception that lets a crew member edit a locked
availability window. Unique on (user_id, window_start) so re-grants
are idempotent.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j4e5f6g7h8i9'
down_revision: Union[str, Sequence[str], None] = 'i3d4e5f6g7h8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'availability_unlocks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('window_start', sa.String(), nullable=False),
        sa.Column('granted_by_id', sa.Integer(), nullable=True),
        sa.Column('granted_by_name', sa.String(), nullable=False),
        sa.Column('granted_at', sa.DateTime(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['granted_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'window_start',
            name='uq_availability_unlocks_user_window',
        ),
    )
    op.create_index('ix_availability_unlocks_id', 'availability_unlocks', ['id'])
    op.create_index('ix_availability_unlocks_user_id', 'availability_unlocks', ['user_id'])
    op.create_index('ix_availability_unlocks_window_start', 'availability_unlocks', ['window_start'])


def downgrade() -> None:
    op.drop_index('ix_availability_unlocks_window_start', table_name='availability_unlocks')
    op.drop_index('ix_availability_unlocks_user_id', table_name='availability_unlocks')
    op.drop_index('ix_availability_unlocks_id', table_name='availability_unlocks')
    op.drop_table('availability_unlocks')
