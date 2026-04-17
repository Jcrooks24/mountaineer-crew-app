"""add rods_logs table

Revision ID: r6s7t8u9v0w1
Revises: q5r6s7t8u9v0
Create Date: 2026-04-17 00:00:06.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'r6s7t8u9v0w1'
down_revision: Union[str, Sequence[str], None] = 'q5r6s7t8u9v0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'rods_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('rods_id', sa.String(), nullable=False),
        sa.Column('driver_id', sa.Integer(), nullable=True),
        sa.Column('driver_name', sa.String(), nullable=False),
        sa.Column('log_date', sa.String(), nullable=False),
        sa.Column('co_driver_name', sa.String(), nullable=True),
        sa.Column('vehicle_number', sa.String(), nullable=True),
        sa.Column('trailer_number', sa.String(), nullable=True),
        sa.Column('origin', sa.String(), nullable=True),
        sa.Column('destination', sa.String(), nullable=True),
        sa.Column('total_miles', sa.String(), nullable=True),
        sa.Column('shipping_docs', sa.String(), nullable=True),
        sa.Column('carrier', sa.String(), nullable=True),
        sa.Column('main_office_address', sa.String(), nullable=True),
        sa.Column('duty_changes_json', sa.Text(), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('total_off_duty', sa.String(), nullable=True),
        sa.Column('total_sleeper', sa.String(), nullable=True),
        sa.Column('total_driving', sa.String(), nullable=True),
        sa.Column('total_on_duty', sa.String(), nullable=True),
        sa.Column('signature', sa.Text(), nullable=False),
        sa.Column('signed_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_rods_logs_id'), 'rods_logs', ['id'], unique=False)
    op.create_index(op.f('ix_rods_logs_rods_id'), 'rods_logs', ['rods_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_rods_logs_rods_id'), table_name='rods_logs')
    op.drop_index(op.f('ix_rods_logs_id'), table_name='rods_logs')
    op.drop_table('rods_logs')
