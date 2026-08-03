"""job-scoped payroll corrections + entry-status attestation (2c)

Revision ID: e1a3c5d7f9b2
Revises: d9e1f3a5b7c9
Create Date: 2026-08-03

Moves hour corrections from the payroll period to the job (ADR 0032, amends
0029). Two schema shifts fall out of that:

  payroll_corrections
    - a nullable `job_uuid`. When set, the correction is scoped to the job and
      flows into whatever pay period contains that job's date, rather than being
      pinned to one period. period_start / period_end become nullable because a
      job-scoped correction has no period of its own.
    - a partial unique index so a job has at most one correction per
      (employee, bucket). The old period-keyed unique constraint still governs
      the legacy / non-job corrections (off-job, office, manual).

  admin_entry_status
    - the initialing checkpoint becomes a three-part attestation:
      validated (I reviewed the record), corrected (I made any needed
      corrections), confirmed_in_sheet (I confirmed the row landed in the
      Google Sheet). Existing rows are backfilled true: a row only exists
      because an admin already signed off under the old, weaker meaning, and
      forcing every historical job back to "unattested" would be noise.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1a3c5d7f9b2'
down_revision: Union[str, Sequence[str], None] = 'd9e1f3a5b7c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # payroll_corrections: job scope.
    op.add_column('payroll_corrections', sa.Column('job_uuid', sa.String(), nullable=True))
    op.create_index('ix_payroll_corrections_job_uuid', 'payroll_corrections', ['job_uuid'])
    # A job-scoped correction carries no period, so the period columns must
    # allow NULL. Existing rows keep their non-null periods untouched.
    op.alter_column('payroll_corrections', 'period_start', existing_type=sa.String(), nullable=True)
    op.alter_column('payroll_corrections', 'period_end', existing_type=sa.String(), nullable=True)
    # One correction per (employee, job, bucket) among the job-scoped rows. The
    # old uq_payroll_correction_target still covers the period-scoped rows; its
    # NULL periods make job rows non-conflicting there, so the two never fight.
    op.create_index(
        'uq_payroll_correction_job',
        'payroll_corrections',
        ['user_id', 'job_uuid', 'bucket'],
        unique=True,
        postgresql_where=sa.text('job_uuid IS NOT NULL'),
    )

    # admin_entry_status: three-part attestation.
    op.add_column('admin_entry_status', sa.Column('validated', sa.Boolean(), nullable=True))
    op.add_column('admin_entry_status', sa.Column('corrected', sa.Boolean(), nullable=True))
    op.add_column('admin_entry_status', sa.Column('confirmed_in_sheet', sa.Boolean(), nullable=True))
    op.execute(
        "UPDATE admin_entry_status "
        "SET validated = true, corrected = true, confirmed_in_sheet = true"
    )


def downgrade() -> None:
    op.drop_column('admin_entry_status', 'confirmed_in_sheet')
    op.drop_column('admin_entry_status', 'corrected')
    op.drop_column('admin_entry_status', 'validated')

    op.drop_index('uq_payroll_correction_job', table_name='payroll_corrections')
    op.alter_column('payroll_corrections', 'period_end', existing_type=sa.String(), nullable=False)
    op.alter_column('payroll_corrections', 'period_start', existing_type=sa.String(), nullable=False)
    op.drop_index('ix_payroll_corrections_job_uuid', table_name='payroll_corrections')
    op.drop_column('payroll_corrections', 'job_uuid')
