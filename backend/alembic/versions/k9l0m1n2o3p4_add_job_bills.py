"""add job_bills table

Revision ID: k9l0m1n2o3p4
Revises: j8k9l0m1n2o3
Create Date: 2026-04-16 00:00:02.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'k9l0m1n2o3p4'
down_revision: Union[str, Sequence[str], None] = 'j8k9l0m1n2o3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'job_bills',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('saved_by_id', sa.Integer(), nullable=True),
        sa.Column('saved_by_name', sa.String(), nullable=True),
        sa.Column('items_json', sa.Text(), nullable=False),
        sa.Column('global_discount', sa.Float(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_job_bills_id'), 'job_bills', ['id'], unique=False)
    op.create_index(op.f('ix_job_bills_job_uuid'), 'job_bills', ['job_uuid'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_job_bills_job_uuid'), table_name='job_bills')
    op.drop_index(op.f('ix_job_bills_id'), table_name='job_bills')
    op.drop_table('job_bills')
