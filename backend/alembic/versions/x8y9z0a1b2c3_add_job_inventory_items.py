"""add job_inventory_items table

Revision ID: x8y9z0a1b2c3
Revises: w7x8y9z0a1b2
Create Date: 2026-07-06

Phase 2: the actual inventory a crew logs on a job (keyed by job_uuid).
Furniture count and box count are derived from these rows. No parent table -
items attach directly to a job like events/materials/photos.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x8y9z0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'w7x8y9z0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_inventory_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('is_box', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('room', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_job_inventory_items_id'), 'job_inventory_items', ['id'], unique=False)
    op.create_index(op.f('ix_job_inventory_items_job_uuid'), 'job_inventory_items', ['job_uuid'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_job_inventory_items_job_uuid'), table_name='job_inventory_items')
    op.drop_index(op.f('ix_job_inventory_items_id'), table_name='job_inventory_items')
    op.drop_table('job_inventory_items')
