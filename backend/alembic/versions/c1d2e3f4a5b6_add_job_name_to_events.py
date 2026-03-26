"""add job_name to events

Revision ID: c1d2e3f4a5b6
Revises: b2c3d4e5f6a7
Create Date: 2026-03-26

"""
from alembic import op
import sqlalchemy as sa

revision = 'c1d2e3f4a5b6'
down_revision = 'b2c3d4e5f6a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('events', sa.Column('job_name', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'job_name')
