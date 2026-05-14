"""add reimbursements table

Revision ID: z4a5b6c7d8e9
Revises: y3z4a5b6c7d8
Create Date: 2026-05-14

New table for the Reimbursement feature. Crew submits a mileage or
business-expense reimbursement request with photo evidence stored in
Drive; admin approves on the same row. One row per request, identified
by reimbursement_uuid (offline-idempotency key).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'z4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'y3z4a5b6c7d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reimbursements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('reimbursement_uuid', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('type', sa.String(length=16), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('job_date', sa.String(), nullable=True),
        sa.Column('odometer_start', sa.Integer(), nullable=True),
        sa.Column('odometer_end', sa.Integer(), nullable=True),
        sa.Column('odometer_start_photo_drive_id', sa.String(), nullable=True),
        sa.Column('odometer_start_photo_url', sa.String(), nullable=True),
        sa.Column('odometer_end_photo_drive_id', sa.String(), nullable=True),
        sa.Column('odometer_end_photo_url', sa.String(), nullable=True),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('receipt_photo_drive_id', sa.String(), nullable=True),
        sa.Column('receipt_photo_url', sa.String(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='submitted'),
        sa.Column('approver_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('approver_name', sa.String(), nullable=True),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('approval_notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'ix_reimbursements_reimbursement_uuid',
        'reimbursements',
        ['reimbursement_uuid'],
        unique=True,
    )
    op.create_index(
        'ix_reimbursements_type',
        'reimbursements',
        ['type'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_reimbursements_type', table_name='reimbursements')
    op.drop_index('ix_reimbursements_reimbursement_uuid', table_name='reimbursements')
    op.drop_table('reimbursements')
