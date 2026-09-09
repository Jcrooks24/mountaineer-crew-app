"""One correction per target among DATE-scoped non-job corrections.

Off-job hour corrections (2026-09-09) are date-scoped: they carry no period,
because there is no pay-period table to stamp them with, and the entry's own
work_date decides which period pays them. That is the same shape a job
correction has had since ADR 0032.

Neither existing uniqueness rule reaches them:

  * uq_payroll_correction_target is keyed on (period_start, period_end, ...),
    and both are NULL here. Postgres treats NULLs as distinct, so it never
    conflicts and an unlimited number of duplicates is allowed.
  * uq_payroll_correction_job is partial on job_uuid IS NOT NULL, and these
    rows have no job.

A duplicate would not double-pay - _apply_corrections keys by target and one
would simply win - but it does make "what did we correct, and why" ambiguous,
and it leaves the upsert's read-then-write open to a race. This closes the gap
with the same rule the other two enforce.

Revision ID: r8t0v2q4s6u8
Revises: q7s9u1p3r5t7
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'r8t0v2q4s6u8'
down_revision: Union[str, None] = 'q7s9u1p3r5t7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Postgres only, and the guard is load-bearing rather than tidiness.
    # `postgresql_where` is SILENTLY DROPPED on SQLite, so on a dev database
    # this would create a FULL unique index over (user_id, source, source_key,
    # bucket) - which also binds the period-scoped rows it is meant to exclude,
    # and would reject a legitimate second correction to the same target in a
    # different period. Staging and production are both Postgres; dev keeps the
    # application-level check in upsert_off_job_correction, which is what
    # actually runs on a single-admin dev box anyway.
    #
    # Keyed on source + source_key rather than on one column the way the job
    # index is: a date-scoped non-job correction is identified by which record
    # it points at, and "off_job" is only the first such source.
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.create_index(
        'uq_payroll_correction_dated',
        'payroll_corrections',
        ['user_id', 'source', 'source_key', 'bucket'],
        unique=True,
        postgresql_where=sa.text('period_start IS NULL AND job_uuid IS NULL'),
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != 'postgresql':
        return
    op.drop_index('uq_payroll_correction_dated', table_name='payroll_corrections')
