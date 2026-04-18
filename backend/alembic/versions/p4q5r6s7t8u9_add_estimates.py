"""add estimates and estimate_items tables

Revision ID: p4q5r6s7t8u9
Revises: o3p4q5r6s7t8
Create Date: 2026-04-17 00:00:04.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'p4q5r6s7t8u9'
down_revision: Union[str, Sequence[str], None] = 'o3p4q5r6s7t8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'estimates',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('estimate_uuid', sa.String(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('customer_name', sa.String(), nullable=False),
        sa.Column('customer_email', sa.String(), nullable=True),
        sa.Column('customer_phone', sa.String(), nullable=True),
        sa.Column('origin_address', sa.String(), nullable=True),
        sa.Column('destination_address', sa.String(), nullable=True),
        sa.Column('move_date', sa.String(), nullable=True),
        sa.Column('origin_access_notes', sa.Text(), nullable=True),
        sa.Column('destination_access_notes', sa.Text(), nullable=True),
        sa.Column('special_items_notes', sa.Text(), nullable=True),
        sa.Column('general_notes', sa.Text(), nullable=True),
        sa.Column('estimated_weight_lbs', sa.Float(), nullable=False),
        sa.Column('estimated_cubic_ft', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_estimates_id'), 'estimates', ['id'], unique=False)
    op.create_index(op.f('ix_estimates_estimate_uuid'), 'estimates', ['estimate_uuid'], unique=True)

    op.create_table(
        'estimate_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('estimate_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('weight_lbs', sa.Float(), nullable=False),
        sa.Column('cubic_ft', sa.Float(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['estimate_id'], ['estimates.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_estimate_items_id'), 'estimate_items', ['id'], unique=False)
    op.create_index(op.f('ix_estimate_items_estimate_id'), 'estimate_items', ['estimate_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_estimate_items_estimate_id'), table_name='estimate_items')
    op.drop_index(op.f('ix_estimate_items_id'), table_name='estimate_items')
    op.drop_table('estimate_items')
    op.drop_index(op.f('ix_estimates_estimate_uuid'), table_name='estimates')
    op.drop_index(op.f('ix_estimates_id'), table_name='estimates')
    op.drop_table('estimates')
