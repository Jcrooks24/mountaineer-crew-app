"""add prior_on_duty_statements table

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2026-04-17 00:00:02.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'n2o3p4q5r6s7'
down_revision: Union[str, Sequence[str], None] = 'm1n2o3p4q5r6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'prior_on_duty_statements',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('statement_id', sa.String(), nullable=False),
        sa.Column('driver_id', sa.Integer(), nullable=True),
        sa.Column('driver_name', sa.String(), nullable=False),
        sa.Column('statement_date', sa.String(), nullable=False),
        sa.Column('daily_hours_json', sa.Text(), nullable=False),
        sa.Column('hours_last_24', sa.String(), nullable=False),
        sa.Column('signature', sa.Text(), nullable=False),
        sa.Column('signed_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_prior_on_duty_statements_id'), 'prior_on_duty_statements', ['id'], unique=False)
    op.create_index(op.f('ix_prior_on_duty_statements_statement_id'), 'prior_on_duty_statements', ['statement_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_prior_on_duty_statements_statement_id'), table_name='prior_on_duty_statements')
    op.drop_index(op.f('ix_prior_on_duty_statements_id'), table_name='prior_on_duty_statements')
    op.drop_table('prior_on_duty_statements')
