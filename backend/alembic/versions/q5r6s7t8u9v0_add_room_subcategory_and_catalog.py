"""add room/subcategory to estimate_items and furniture_catalog table

Revision ID: q5r6s7t8u9v0
Revises: p4q5r6s7t8u9
Create Date: 2026-04-17 00:00:05.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'q5r6s7t8u9v0'
down_revision: Union[str, Sequence[str], None] = 'p4q5r6s7t8u9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('estimate_items') as batch_op:
        batch_op.add_column(sa.Column('room', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('subcategory', sa.String(), nullable=True))

    op.create_table(
        'furniture_catalog',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('weight_lbs', sa.Float(), nullable=False),
        sa.Column('cubic_ft', sa.Float(), nullable=False),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_index(op.f('ix_furniture_catalog_id'), 'furniture_catalog', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_furniture_catalog_id'), table_name='furniture_catalog')
    op.drop_table('furniture_catalog')
    with op.batch_alter_table('estimate_items') as batch_op:
        batch_op.drop_column('subcategory')
        batch_op.drop_column('room')
