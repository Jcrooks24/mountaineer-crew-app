"""add app_builds, and link a patch note to a build

Revision ID: f6h8j0e2g4i6
Revises: e5g7i9d1f3h5
Create Date: 2026-08-12

Patch notes were a list of announcements with no version history behind them: a
build shipped without a note left no trace, and a note said nothing about which
build it described.

`app_builds` records each frontend build a crew device actually loaded, and
`patch_notes.build_id` optionally ties a note to one.

Nullable and unbackfilled. Existing notes predate any build record and there is
no honest way to guess which build they described - the timestamps would only let
us assert a plausible pairing, not a true one. They render as notes with no build
attached, which is exactly what they are.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6h8j0e2g4i6'
down_revision: Union[str, Sequence[str], None] = 'e5g7i9d1f3h5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'app_builds',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('build_id', sa.String(), nullable=False),
        sa.Column('version_name', sa.String(), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_app_builds_build_id', 'app_builds', ['build_id'], unique=True)
    op.create_index('ix_app_builds_first_seen_at', 'app_builds', ['first_seen_at'])
    op.add_column('patch_notes', sa.Column('build_id', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('patch_notes', 'build_id')
    op.drop_index('ix_app_builds_first_seen_at', table_name='app_builds')
    op.drop_index('ix_app_builds_build_id', table_name='app_builds')
    op.drop_table('app_builds')
