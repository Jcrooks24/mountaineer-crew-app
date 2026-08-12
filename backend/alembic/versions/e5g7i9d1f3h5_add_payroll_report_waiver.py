"""add payroll report waiver to admin_entry_status

Revision ID: e5g7i9d1f3h5
Revises: d4f6h8c0e2g4
Create Date: 2026-08-12

Some jobs legitimately never get a job report - off-job hours logged against a
manual job, an unpaid drive leg - and the payroll finalize gate blocked forever
waiting for one. An admin can now waive the requirement per job, with a reason.

Nullable and unbackfilled: a null `report_waived` means "not waived", which is
the correct state for every job that exists today. The gate reads `is_(True)`,
so null and false behave identically and no data migration is needed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5g7i9d1f3h5'
down_revision: Union[str, Sequence[str], None] = 'd4f6h8c0e2g4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('admin_entry_status', sa.Column('report_waived', sa.Boolean(), nullable=True))
    op.add_column('admin_entry_status', sa.Column('report_waived_reason', sa.String(), nullable=True))
    op.add_column('admin_entry_status', sa.Column('report_waived_by_name', sa.String(), nullable=True))
    op.add_column('admin_entry_status', sa.Column('report_waived_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('admin_entry_status', 'report_waived_at')
    op.drop_column('admin_entry_status', 'report_waived_by_name')
    op.drop_column('admin_entry_status', 'report_waived_reason')
    op.drop_column('admin_entry_status', 'report_waived')
