"""Index the two date columns the reimbursement reads window on.

`_reimbursements` (the payroll page) and the admin reimbursement search both
filter on `expense_date` and fall back to / order by `created_at`. Neither column
was indexed, because until 2026-09-09 the payroll aggregator did not filter at
all - it loaded the whole table and threw most of it away in Python, which is the
OOM class CLAUDE.md warns about and what the vet that day found.

Narrowing that query bounded the MEMORY. This bounds the work: without an index
Postgres still walks every row of a table that only ever grows, on a page the
office opens repeatedly during a payroll run, in a process that recycles on a
request budget.

Two plain indexes rather than a composite. The two columns are used in separate
queries (one per branch of the date fallback), never together in one predicate.

Revision ID: s9u1w3r5t7v9
Revises: r8t0v2q4s6u8
"""
from typing import Sequence, Union

from alembic import op

revision: str = 's9u1w3r5t7v9'
down_revision: Union[str, None] = 'r8t0v2q4s6u8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_reimbursements_expense_date', 'reimbursements', ['expense_date'])
    op.create_index('ix_reimbursements_created_at', 'reimbursements', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_reimbursements_created_at', table_name='reimbursements')
    op.drop_index('ix_reimbursements_expense_date', table_name='reimbursements')
