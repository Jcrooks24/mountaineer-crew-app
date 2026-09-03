"""add employee_tips

Tips existed only as a line on the customer's bill. Nothing recorded a tip being
paid OUT to a crew member, so payroll had no way to include one and the office
tracked them outside the app.

`tip_date` rather than the job's date decides the pay period, because tips arrive
late: a customer rings two weeks after the move and the job's period has been
finalized. See the model's docstring.

`job_uuid` is a plain column and not a foreign key, matching payroll_corrections:
a tip is the office's record of money owed and must survive the job row being
edited or removed. A dangling tip is still a debt.

Revision ID: k1m3o5j7l9n1
Revises: j0l2n4i6k8m0
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'k1m3o5j7l9n1'
down_revision: Union[str, Sequence[str], None] = 'j0l2n4i6k8m0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'employee_tips',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tip_uuid', sa.String(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=True),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('user_name', sa.String(), nullable=False),
        sa.Column('tip_date', sa.String(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_employee_tips_tip_uuid', 'employee_tips', ['tip_uuid'], unique=True)
    op.create_index('ix_employee_tips_job_uuid', 'employee_tips', ['job_uuid'])
    op.create_index('ix_employee_tips_user_id', 'employee_tips', ['user_id'])
    op.create_index('ix_employee_tips_tip_date', 'employee_tips', ['tip_date'])
    op.create_index('ix_employee_tips_date_user', 'employee_tips', ['tip_date', 'user_id'])


def downgrade() -> None:
    op.drop_index('ix_employee_tips_date_user', table_name='employee_tips')
    op.drop_index('ix_employee_tips_tip_date', table_name='employee_tips')
    op.drop_index('ix_employee_tips_user_id', table_name='employee_tips')
    op.drop_index('ix_employee_tips_job_uuid', table_name='employee_tips')
    op.drop_index('ix_employee_tips_tip_uuid', table_name='employee_tips')
    op.drop_table('employee_tips')
