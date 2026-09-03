"""add reimbursements.paid_at / paid_period_start / paid_period_end

A reimbursement had an approval state (submitted / approved / rejected) and no
record of ever having been PAID. Payroll pays everything not explicitly declined,
so a claim could be paid on a finalized run and still read "submitted" forever,
and nothing anywhere could answer "has this been reimbursed yet?" - which is the
first question both the crew member and the office ask about a claim.

A separate stamp rather than a `status = "paid"` value, deliberately. Approval
and payment are two different facts about the same row: overwriting the status
would lose who approved it and when, and a rejected claim that somehow got paid
would become indistinguishable from an approved one. Keeping them apart also
means the existing approve/decline flow needs no change at all.

`paid_period_start` / `paid_period_end` record WHICH payroll run paid it, because
"paid" without "on which run" cannot be reconciled against anything.

All three nullable, no default, no backfill. NULL means "not paid through the
app", which is the truth for every claim written before this: earlier periods
were reconciled by hand and this column has no way to know what happened outside
the app. Backfilling anything here would be inventing a payment record.

Revision ID: j0l2n4i6k8m0
Revises: i9k1m3h5j7l9
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'j0l2n4i6k8m0'
down_revision: Union[str, Sequence[str], None] = 'i9k1m3h5j7l9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('reimbursements', sa.Column('paid_at', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('paid_period_start', sa.String(length=10), nullable=True))
    op.add_column('reimbursements', sa.Column('paid_period_end', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('reimbursements', 'paid_period_end')
    op.drop_column('reimbursements', 'paid_period_start')
    op.drop_column('reimbursements', 'paid_at')
