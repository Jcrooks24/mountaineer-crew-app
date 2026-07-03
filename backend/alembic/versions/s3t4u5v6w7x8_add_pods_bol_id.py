"""add bol_id to prior_on_duty_statements

Revision ID: s3t4u5v6w7x8
Revises: r2s3t4u5v6w7
Create Date: 2026-07-02

Attach the PODS to the trip's BOL; a PODS on file for a BOL gates origin signing.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 's3t4u5v6w7x8'
down_revision: Union[str, Sequence[str], None] = 'r2s3t4u5v6w7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('prior_on_duty_statements', sa.Column('bol_id', sa.String(), nullable=True))
    op.create_index('ix_prior_on_duty_statements_bol_id', 'prior_on_duty_statements', ['bol_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_prior_on_duty_statements_bol_id', table_name='prior_on_duty_statements')
    op.drop_column('prior_on_duty_statements', 'bol_id')
