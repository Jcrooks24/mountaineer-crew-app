"""add photos_drive_url to reimbursements

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-05-15

A single Drive link per submission, surfaced in the Reimbursements sheet
so admin can click straight to the photo location — the per-submission
odometer folder for mileage, or the receipt file for an expense.
Nullable; submissions with no photos leave it null.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursements', sa.Column('photos_drive_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursements', 'photos_drive_url')
