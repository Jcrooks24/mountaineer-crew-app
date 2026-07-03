"""add bill_personal_vehicles to job_reports

Revision ID: v6w7x8y9z0a1
Revises: u5v6w7x8y9z0
Create Date: 2026-07-03

Persists the "bill these personal vehicles as crew transport ($100/day)"
checkbox on the Report tab so its state survives a report reload and
carries across devices - without this column, opening the report on a
second device would wipe any auto-populated crew transport line items
because the flag defaulted to False on load.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v6w7x8y9z0a1'
down_revision: Union[str, Sequence[str], None] = 'u5v6w7x8y9z0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'job_reports',
        sa.Column('bill_personal_vehicles', sa.Boolean(), nullable=True, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('job_reports', 'bill_personal_vehicles')
