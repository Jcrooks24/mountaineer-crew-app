"""add reimbursements.qb_status / qb_entered_at / qb_entered_by_name

The office re-keys reimbursements and mileage into QuickBooks by hand. Nothing
recorded whether a given claim had been entered yet, so the only way to know was
to remember, and the failure mode is entering the same receipt twice.

Three states exist in the world and only two are worth storing: "pending entry"
and "entered". Anything declined never reaches QuickBooks at all, which the
status column already says, so it is not a third value here.

`qb_status` defaults to 'pending' for every existing row. That is a claim about
the future, not the past: nothing in the app knows what the office has already
keyed in, and marking history as entered would be inventing a record. The office
marks off what it has done from the new admin module.

Revision ID: n4p6r8m0o2q4
Revises: m3o5q7l9n1p3
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'n4p6r8m0o2q4'
down_revision: Union[str, Sequence[str], None] = 'm3o5q7l9n1p3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'reimbursements',
        sa.Column('qb_status', sa.String(length=16), nullable=False, server_default='pending'),
    )
    op.add_column('reimbursements', sa.Column('qb_entered_at', sa.DateTime(), nullable=True))
    op.add_column('reimbursements', sa.Column('qb_entered_by_name', sa.String(), nullable=True))
    # The module's default view is "what still needs entering", so this is the
    # query that runs every time somebody opens it.
    op.create_index('ix_reimbursements_qb_status', 'reimbursements', ['qb_status'])


def downgrade() -> None:
    op.drop_index('ix_reimbursements_qb_status', table_name='reimbursements')
    op.drop_column('reimbursements', 'qb_entered_by_name')
    op.drop_column('reimbursements', 'qb_entered_at')
    op.drop_column('reimbursements', 'qb_status')
