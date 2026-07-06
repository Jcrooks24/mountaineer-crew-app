"""add pack_type to job_inventory_items

Revision ID: b1d3f5a7c9e2
Revises: a1b2c3d4e5f7
Create Date: 2026-07-06

Box items carry a pack-type classification: CP (carrier packed), PBO (packed
by owner), or NA. Null for furniture rows. Required on the client when adding
a box; the column is nullable so existing rows and furniture stay valid.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1d3f5a7c9e2'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_inventory_items', sa.Column('pack_type', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_inventory_items', 'pack_type')
