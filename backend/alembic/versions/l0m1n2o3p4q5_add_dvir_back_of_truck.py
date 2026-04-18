"""add back_of_truck_confirmed and overnight_hold to dvirs

Revision ID: l0m1n2o3p4q5
Revises: k9l0m1n2o3p4
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'l0m1n2o3p4q5'
down_revision: Union[str, Sequence[str], None] = 'k9l0m1n2o3p4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.add_column(sa.Column('back_of_truck_confirmed', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('overnight_hold', sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.drop_column('overnight_hold')
        batch_op.drop_column('back_of_truck_confirmed')
