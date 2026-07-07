"""furniture catalog dimensions + custom fields

Revision ID: a7c9e1f3b5d2
Revises: f5b7c9e1d3a4
Create Date: 2026-07-07

Adds L/W/H dimensions (inches) plus packing_type, fragile, sku, and notes to the
furniture catalog so admin can maintain richer item data via the CSV round-trip.
cubic_ft is auto-derived from L*W*H on import when dimensions are supplied.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c9e1f3b5d2'
down_revision: Union[str, Sequence[str], None] = 'f5b7c9e1d3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("furniture_catalog", sa.Column("length_in", sa.Float(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("width_in", sa.Float(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("height_in", sa.Float(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("packing_type", sa.String(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("fragile", sa.Boolean(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("sku", sa.String(), nullable=True))
    op.add_column("furniture_catalog", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("furniture_catalog", "notes")
    op.drop_column("furniture_catalog", "sku")
    op.drop_column("furniture_catalog", "fragile")
    op.drop_column("furniture_catalog", "packing_type")
    op.drop_column("furniture_catalog", "height_in")
    op.drop_column("furniture_catalog", "width_in")
    op.drop_column("furniture_catalog", "length_in")
