"""add admin_entry_status table

Revision ID: w1x2y3z4a5b6
Revises: v0w1x2y3z4a5
Create Date: 2026-05-08

Tracks admin "I've reviewed this job and entered the data into our books"
checkpoints. One row per job_uuid; admin updates initials + date when they
finish data entry. Surfaced on the Admin Job Summary card, in job-search
results, and as new entered_by / entered_on columns on every job-related
worksheet (Events, Materials, JobReports, Bills).
"""
from alembic import op
import sqlalchemy as sa


revision = 'w1x2y3z4a5b6'
down_revision = 'v0w1x2y3z4a5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'admin_entry_status',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('job_uuid', sa.String(), nullable=False, unique=True, index=True),
        sa.Column('entered_by', sa.String(), nullable=False),  # crew/admin initials
        sa.Column('entered_on', sa.String(), nullable=False),  # YYYY-MM-DD, kept as text for sheet-friendliness
        sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_by_name', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('admin_entry_status')
