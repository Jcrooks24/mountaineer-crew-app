"""add inventory verification fields to digital_bols

Revision ID: u5v6w7x8y9z0
Revises: t4u5v6w7x8y9
Create Date: 2026-07-03

Adds an inventory_verified flag + a free-text inventory_note that the crew
fills in on the Inventory tab. inventory_verified=1 means "this is a complete
record of everything on the truck"; when 0, the note explains why not.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u5v6w7x8y9z0'
down_revision: Union[str, Sequence[str], None] = 't4u5v6w7x8y9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('digital_bols', sa.Column('inventory_verified', sa.Integer(), nullable=True))
    op.add_column('digital_bols', sa.Column('inventory_note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('digital_bols', 'inventory_note')
    op.drop_column('digital_bols', 'inventory_verified')
