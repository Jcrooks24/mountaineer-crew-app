"""add drive_folder_id to dq_documents

Revision ID: c3e5g7b9d1f3
Revises: b2d4f6a8c1e3
Create Date: 2026-08-10

DQ documents now live in a per-driver subfolder under DRIVE_DQ_FOLDER_ID, created
on the driver's first submission and reused after. This column remembers that
folder's ID so later uploads address it by ID instead of re-resolving it by the
driver's name - which is what keeps a driver who changes their name on ONE
compliance folder instead of silently starting a second one.

Denormalized: the value is per-driver, not per-document, but dq_documents is
already keyed (user_id, doc_type) and any of a driver's rows can supply it. A
separate table for one string was not worth the join.

Nullable, additive. Existing rows keep NULL and resolve by name once on their
next upload, which reproduces today's behavior exactly.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3e5g7b9d1f3'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('dq_documents', sa.Column('drive_folder_id', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('dq_documents', 'drive_folder_id')
