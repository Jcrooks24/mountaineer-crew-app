"""add patch_notes table

Revision ID: s7t8u9v0w1x2
Revises: r6s7t8u9v0w1
Create Date: 2026-04-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's7t8u9v0w1x2'
down_revision: Union[str, Sequence[str], None] = 'r6s7t8u9v0w1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'patch_notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_patch_notes_id'), 'patch_notes', ['id'], unique=False)
    op.create_index(op.f('ix_patch_notes_updated_at'), 'patch_notes', ['updated_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_patch_notes_updated_at'), table_name='patch_notes')
    op.drop_index(op.f('ix_patch_notes_id'), table_name='patch_notes')
    op.drop_table('patch_notes')
