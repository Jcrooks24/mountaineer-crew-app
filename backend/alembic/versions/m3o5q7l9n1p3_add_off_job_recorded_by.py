"""add off_job_entries.recorded_by_id / recorded_by_name

An off-job entry has `submitted_by`, which is both the person the hours belong to
and the person who typed them - true while crew log their own.

PTO breaks that. It is recorded by the office AGAINST an employee (user
direction, 2026-09-03), so `submitted_by` has to stay the employee for payroll to
attribute the hours, and there is nowhere left to record who in the office
entered it. For paid time drawn from an allowance, "who granted this" is exactly
the question somebody will ask.

Nullable, no backfill. NULL means the entry was logged by the person it belongs
to, which is what every row written before this is.

Revision ID: m3o5q7l9n1p3
Revises: l2n4p6k8m0o2
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'm3o5q7l9n1p3'
down_revision: Union[str, Sequence[str], None] = 'l2n4p6k8m0o2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('off_job_entries', sa.Column('recorded_by_id', sa.Integer(), nullable=True))
    op.add_column('off_job_entries', sa.Column('recorded_by_name', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('off_job_entries', 'recorded_by_name')
    op.drop_column('off_job_entries', 'recorded_by_id')
