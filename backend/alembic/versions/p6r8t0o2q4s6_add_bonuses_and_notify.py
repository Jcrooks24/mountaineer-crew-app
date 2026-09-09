"""add employee_bonuses, and a per-line notify flag on payroll corrections

Two halves of one tool. The payroll "add a line" control and the bonus request
merged into a single thing for recording what an employee forgot to log, so the
schema for both lands together.

`payroll_corrections.notify` defaults TRUE, which preserves today's behaviour
exactly: every existing correction still emails the crew member on finalize. It
is opt-OUT rather than opt-in on purpose - a correction that silently changes
somebody's pay without telling them is the worse default, so the quiet path has
to be chosen deliberately.

Revision ID: p6r8t0o2q4s6
Revises: o5q7s9n1p3r5
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'p6r8t0o2q4s6'
down_revision: Union[str, Sequence[str], None] = 'o5q7s9n1p3r5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'employee_bonuses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bonus_uuid', sa.String(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('bonus_date', sa.String(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
    )
    op.create_index('ix_employee_bonuses_id', 'employee_bonuses', ['id'])
    op.create_index('ix_employee_bonuses_bonus_uuid', 'employee_bonuses', ['bonus_uuid'], unique=True)
    op.create_index('ix_employee_bonuses_job_uuid', 'employee_bonuses', ['job_uuid'])
    op.create_index('ix_employee_bonuses_user_id', 'employee_bonuses', ['user_id'])
    op.create_index('ix_employee_bonuses_bonus_date', 'employee_bonuses', ['bonus_date'])
    op.create_index('ix_employee_bonuses_date_user', 'employee_bonuses', ['bonus_date', 'user_id'])

    op.add_column(
        'payroll_corrections',
        sa.Column('notify', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column('payroll_corrections', 'notify')
    op.drop_index('ix_employee_bonuses_date_user', table_name='employee_bonuses')
    op.drop_index('ix_employee_bonuses_bonus_date', table_name='employee_bonuses')
    op.drop_index('ix_employee_bonuses_user_id', table_name='employee_bonuses')
    op.drop_index('ix_employee_bonuses_job_uuid', table_name='employee_bonuses')
    op.drop_index('ix_employee_bonuses_bonus_uuid', table_name='employee_bonuses')
    op.drop_index('ix_employee_bonuses_id', table_name='employee_bonuses')
    op.drop_table('employee_bonuses')
