"""add last_edited_by to job_reports

Revision ID: d4f6h8c0e2g4
Revises: c3e5g7b9d1f3
Create Date: 2026-08-12

`submitted_by_*` was being reassigned to the current user on every update, so a
job report was attributed to whoever saved it last rather than to whoever filed
it. Splitting the two apart: `submitted_by_*` becomes write-once and these
columns carry the edit.

Nullable and not backfilled. Null means nobody has edited the report since it
was created, which is a true statement for every existing row: we cannot know
who edited them, only who saved last, and that value is already sitting in
`submitted_by_*` (wrongly, for any report an admin touched). Writing it into
`last_edited_by_*` as well would dress a guess up as a record.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f6h8c0e2g4'
down_revision: Union[str, Sequence[str], None] = 'c3e5g7b9d1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('last_edited_by_id', sa.Integer(), nullable=True))
    op.add_column('job_reports', sa.Column('last_edited_by_name', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'last_edited_by_name')
    op.drop_column('job_reports', 'last_edited_by_id')
