"""add dvirs table

Revision ID: i7j8k9l0m1n2
Revises: h6i7j8k9l0m1
Create Date: 2026-04-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i7j8k9l0m1n2'
down_revision: Union[str, Sequence[str], None] = 'h6i7j8k9l0m1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dvirs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('dvir_id', sa.String(), nullable=False),
        sa.Column('vehicle_number', sa.String(), nullable=False),
        sa.Column('trailer_number', sa.String(), nullable=True),
        sa.Column('odometer', sa.Integer(), nullable=True),
        sa.Column('inspection_type', sa.String(), nullable=False),
        sa.Column('inspection_date', sa.String(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_id', sa.Integer(), nullable=True),
        sa.Column('defects_json', sa.Text(), nullable=True),
        sa.Column('defect_notes', sa.Text(), nullable=True),
        sa.Column('condition', sa.String(), nullable=False),
        sa.Column('driver_id', sa.Integer(), nullable=True),
        sa.Column('driver_name', sa.String(), nullable=False),
        sa.Column('driver_signature', sa.Text(), nullable=False),
        sa.Column('driver_signed_at', sa.DateTime(), nullable=False),
        sa.Column('mechanic_id', sa.Integer(), nullable=True),
        sa.Column('mechanic_name', sa.String(), nullable=True),
        sa.Column('mechanic_signature', sa.Text(), nullable=True),
        sa.Column('mechanic_signed_at', sa.DateTime(), nullable=True),
        sa.Column('repairs_made', sa.Boolean(), nullable=True),
        sa.Column('mechanic_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_dvirs_id'), 'dvirs', ['id'], unique=False)
    op.create_index(op.f('ix_dvirs_dvir_id'), 'dvirs', ['dvir_id'], unique=True)
    op.create_index(op.f('ix_dvirs_job_uuid'), 'dvirs', ['job_uuid'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dvirs_job_uuid'), table_name='dvirs')
    op.drop_index(op.f('ix_dvirs_dvir_id'), table_name='dvirs')
    op.drop_index(op.f('ix_dvirs_id'), table_name='dvirs')
    op.drop_table('dvirs')
