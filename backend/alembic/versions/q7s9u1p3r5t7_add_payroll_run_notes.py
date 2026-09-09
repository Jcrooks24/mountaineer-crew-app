"""add payroll_runs.notes_snapshot

The payroll notes field is ONE ROLLING NOTE (office direction): it carries
across periods rather than starting blank each time, because the information in
it is standing information. Finalizing archives what it said at that moment
without clearing it.

The archive has to be a stored snapshot for the same reason `rows_json` is: the
note keeps changing after a run is finalized, so re-deriving it later would
publish whatever it says NOW rather than what it said when that payroll was run.
A backfill re-drive would then quietly rewrite history.

Nullable, no backfill: runs finalized before the notes field existed have no
snapshot, and inventing one would be inventing a record.

Revision ID: q7s9u1p3r5t7
Revises: p6r8t0o2q4s6
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'q7s9u1p3r5t7'
down_revision: Union[str, Sequence[str], None] = 'p6r8t0o2q4s6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('payroll_runs', sa.Column('notes_snapshot', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('payroll_runs', 'notes_snapshot')
