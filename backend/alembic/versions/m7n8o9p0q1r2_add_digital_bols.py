"""add digital_bols table

Revision ID: m7n8o9p0q1r2
Revises: l6g7h8i9j0k1
Create Date: 2026-07-01

New table for the Digital Bill of Lading feature (interstate / long-distance
moves). Crew builds the declared inventory in the field; one row per BOL,
identified by bol_id (offline-idempotency key). Items are stored as JSON.
Signature + signed-PDF columns are created now (nullable) so the Push 2
origin/destination signing flow needs no further migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm7n8o9p0q1r2'
down_revision: Union[str, Sequence[str], None] = 'l6g7h8i9j0k1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'digital_bols',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('bol_id', sa.String(), nullable=False),
        sa.Column('created_by', sa.String(), nullable=False, server_default=''),
        sa.Column('driver_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('job_date', sa.String(), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'),
        sa.Column('carrier_json', sa.Text(), nullable=True),
        sa.Column('shipment_json', sa.Text(), nullable=True),
        sa.Column('items_json', sa.Text(), nullable=False, server_default='[]'),
        # Push 2 — signatures (base64 PNG data URLs)
        sa.Column('origin_shipper_sig', sa.Text(), nullable=True),
        sa.Column('origin_carrier_sig', sa.Text(), nullable=True),
        sa.Column('origin_signed_at', sa.DateTime(), nullable=True),
        sa.Column('dest_shipper_sig', sa.Text(), nullable=True),
        sa.Column('dest_carrier_sig', sa.Text(), nullable=True),
        sa.Column('dest_signed_at', sa.DateTime(), nullable=True),
        sa.Column('walkthrough_notes', sa.Text(), nullable=True),
        sa.Column('final_charges', sa.Numeric(precision=10, scale=2), nullable=True),
        # Push 2 — signed PDF in Drive
        sa.Column('signed_pdf_drive_id', sa.String(), nullable=True),
        sa.Column('signed_pdf_url', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index(
        'ix_digital_bols_bol_id',
        'digital_bols',
        ['bol_id'],
        unique=True,
    )
    op.create_index(
        'ix_digital_bols_job_uuid',
        'digital_bols',
        ['job_uuid'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_digital_bols_job_uuid', table_name='digital_bols')
    op.drop_index('ix_digital_bols_bol_id', table_name='digital_bols')
    op.drop_table('digital_bols')
