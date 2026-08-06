"""add bol_header_json to job_setup

Revision ID: b2d4f6a8c1e3
Revises: a1c3e5f7b9d1
Create Date: 2026-08-06

Long-distance job setup now owns the BOL shipment header (ADR 0034: the job header
seeds the tools). Stored as one JSON dict column, matching the crew_json/stops_json
convention on this table; it seeds the Bill of Lading blank-only. Nullable, additive.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2d4f6a8c1e3'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_setup', sa.Column('bol_header_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_setup', 'bol_header_json')
