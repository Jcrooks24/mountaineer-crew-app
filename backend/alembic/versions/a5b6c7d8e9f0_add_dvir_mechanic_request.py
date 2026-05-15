"""add mechanic signature request columns to dvirs

Revision ID: a5b6c7d8e9f0
Revises: z4a5b6c7d8e9
Create Date: 2026-05-15

Supports the remote mechanic e-signature feature: when an admin emails a
sign-off link to a mechanic, the request is stamped here so the Admin →
DVIR Review screen can show "request sent to X — awaiting signature".
Both columns are nullable; older DVIRs simply have no request on file.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, Sequence[str], None] = 'z4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('dvirs', sa.Column('mechanic_signature_requested_at', sa.DateTime(), nullable=True))
    op.add_column('dvirs', sa.Column('mechanic_signature_requested_email', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('dvirs', 'mechanic_signature_requested_email')
    op.drop_column('dvirs', 'mechanic_signature_requested_at')
