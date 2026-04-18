"""add admin_notes table

Revision ID: t8u9v0w1x2y3
Revises: s7t8u9v0w1x2
Create Date: 2026-04-18 00:00:01.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 't8u9v0w1x2y3'
down_revision: Union[str, Sequence[str], None] = 's7t8u9v0w1x2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'admin_notes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_admin_notes_id'), 'admin_notes', ['id'], unique=False)
    op.create_index(op.f('ix_admin_notes_job_uuid'), 'admin_notes', ['job_uuid'], unique=False)
    op.create_index(op.f('ix_admin_notes_updated_at'), 'admin_notes', ['updated_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_admin_notes_updated_at'), table_name='admin_notes')
    op.drop_index(op.f('ix_admin_notes_job_uuid'), table_name='admin_notes')
    op.drop_index(op.f('ix_admin_notes_id'), table_name='admin_notes')
    op.drop_table('admin_notes')
