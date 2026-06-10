"""add availability_days table

Revision ID: g1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-06-10

Crew scheduling availability — one row per (user, day) with a status and an
optional note. window_start stamps each row with the 14-day batch it was
originally submitted in so the sheet aggregator can re-group days into the
same row the admin saw before.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f0a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'availability_days',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('day', sa.String(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('window_start', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'day', name='uq_availability_user_day'),
    )
    op.create_index('ix_availability_days_id', 'availability_days', ['id'])
    op.create_index('ix_availability_days_day', 'availability_days', ['day'])
    op.create_index(
        'ix_availability_days_window_start', 'availability_days', ['window_start']
    )


def downgrade() -> None:
    op.drop_index('ix_availability_days_window_start', table_name='availability_days')
    op.drop_index('ix_availability_days_day', table_name='availability_days')
    op.drop_index('ix_availability_days_id', table_name='availability_days')
    op.drop_table('availability_days')
