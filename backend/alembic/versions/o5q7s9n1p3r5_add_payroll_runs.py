"""add payroll_runs

Records each finalized payroll period. The app previously remembered only the
LATEST one, as a JSON blob in system_config, so "which periods have been
finalized" was unanswerable.

Needed by the Payroll worksheet export: it writes one row per employee per
period, and the backfill audit has to be able to enumerate which periods SHOULD
be on that tab. A sync nobody can audit is one whose stranded rows are invisible.

Additive, and no backfill. Periods finalized before this table existed are not
invented - the only one that could be recovered is the latest, from
system_config, and a one-row history that looks complete is worse than an empty
one that obviously is not.

Revision ID: o5q7s9n1p3r5
Revises: n4p6r8m0o2q4
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'o5q7s9n1p3r5'
down_revision: Union[str, Sequence[str], None] = 'n4p6r8m0o2q4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'payroll_runs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('period_start', sa.String(length=10), nullable=False),
        sa.Column('period_end', sa.String(length=10), nullable=False),
        sa.Column('finalized_at', sa.DateTime(), nullable=False),
        sa.Column('finalized_by_name', sa.String(), nullable=True),
        sa.Column('run_count', sa.Integer(), nullable=False, server_default='1'),
        # Snapshot of the rows written to the Payroll worksheet for this run.
        # The mirror shows what was FINALIZED; recomputing at export time would
        # let a re-drive publish figures nobody finalized.
        sa.Column('rows_json', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('period_start', 'period_end', name='uq_payroll_runs_period'),
    )
    op.create_index('ix_payroll_runs_id', 'payroll_runs', ['id'])
    op.create_index('ix_payroll_runs_period_start', 'payroll_runs', ['period_start'])


def downgrade() -> None:
    op.drop_index('ix_payroll_runs_period_start', table_name='payroll_runs')
    op.drop_index('ix_payroll_runs_id', table_name='payroll_runs')
    op.drop_table('payroll_runs')
