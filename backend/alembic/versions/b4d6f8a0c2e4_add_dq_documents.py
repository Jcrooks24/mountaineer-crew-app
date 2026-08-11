"""add dq_documents (C4 DQ repository)

Revision ID: b4d6f8a0c2e4
Revises: a3c5e7f9b1d3
Create Date: 2026-08-03

The driver-qualification file: one row per (driver, doc_type) holding the most
recent document of that type. The type catalog lives in SystemConfig; this is
the drivers' actual documents.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4d6f8a0c2e4'
down_revision: Union[str, Sequence[str], None] = 'a3c5e7f9b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dq_documents',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('doc_type', sa.String(), nullable=False),
        sa.Column('doc_name', sa.String(), nullable=True),
        sa.Column('drive_file_id', sa.String(), nullable=True),
        sa.Column('drive_url', sa.String(), nullable=True),
        sa.Column('filename', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='submitted'),
        sa.Column('submitted_by_id', sa.Integer(), nullable=True),
        sa.Column('submitted_by_name', sa.String(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'doc_type', name='uq_dq_document_user_type'),
    )
    op.create_index('ix_dq_documents_id', 'dq_documents', ['id'])
    op.create_index('ix_dq_documents_user_id', 'dq_documents', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_dq_documents_user_id', table_name='dq_documents')
    op.drop_index('ix_dq_documents_id', table_name='dq_documents')
    op.drop_table('dq_documents')
