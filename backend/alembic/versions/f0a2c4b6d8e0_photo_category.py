"""add photo category (before / after / general)

Revision ID: f0a2c4b6d8e0
Revises: e8f0a2c4b6d8
Create Date: 2026-08-05

Photos and incidents share one flow: a photo is before / after / general, or it
documents an incident. The incident link already exists (incident_uuid); this
adds the before/after/general category for non-incident photos. Sheet mirror
unchanged.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f0a2c4b6d8e0'
down_revision: Union[str, Sequence[str], None] = 'e8f0a2c4b6d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('photos', sa.Column('category', sa.String(), nullable=False, server_default='general'))


def downgrade() -> None:
    op.drop_column('photos', 'category')
