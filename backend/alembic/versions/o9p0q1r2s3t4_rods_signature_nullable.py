"""make rods_logs signature/signed_at nullable

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-07-01

RODS server continuity: in-progress duty logs are autosaved to the server
unsigned (so a day survives a dead device and resumes cross-device), and the
signature is attached only when the driver finalizes the day. Drop the NOT NULL
on signature + signed_at.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o9p0q1r2s3t4'
down_revision: Union[str, Sequence[str], None] = 'n8o9p0q1r2s3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('rods_logs', 'signature', existing_type=sa.Text(), nullable=True)
    op.alter_column('rods_logs', 'signed_at', existing_type=sa.DateTime(), nullable=True)


def downgrade() -> None:
    # Reverting requires backfilling any NULLs first; unsigned in-progress rows
    # would block this. Left as-is intentionally (forward-only in practice).
    op.alter_column('rods_logs', 'signed_at', existing_type=sa.DateTime(), nullable=False)
    op.alter_column('rods_logs', 'signature', existing_type=sa.Text(), nullable=False)
