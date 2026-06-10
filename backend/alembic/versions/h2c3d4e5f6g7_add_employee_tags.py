"""add employee tags

Revision ID: h2c3d4e5f6g7
Revises: g1b2c3d4e5f6
Create Date: 2026-06-10

Admin-managed tag list for employees + a user_employee_tags join table.
Seeded with the default list from the V1.5 spec (admin can rename / delete
freely afterwards).
"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h2c3d4e5f6g7'
down_revision: Union[str, Sequence[str], None] = 'g1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_TAGS = [
    "Driver",
    "Has CC",
    "YC pass",
    "Tier I",
    "Tier II",
    "Tier III",
    "Tier IV",
    "Art Hanger",
    "Crating",
    "Specialty Packing",
]


def upgrade() -> None:
    op.create_table(
        'employee_tags',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name', name='uq_employee_tags_name'),
    )
    op.create_index('ix_employee_tags_id', 'employee_tags', ['id'])

    op.create_table(
        'user_employee_tags',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('tag_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tag_id'], ['employee_tags.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'tag_id'),
    )

    # Seed defaults so admin has the starter set out of the box.
    now = datetime.now(timezone.utc)
    seed_table = sa.table(
        'employee_tags',
        sa.column('name', sa.String),
        sa.column('sort_order', sa.Integer),
        sa.column('created_at', sa.DateTime),
        sa.column('updated_at', sa.DateTime),
    )
    op.bulk_insert(
        seed_table,
        [
            {
                'name': name,
                'sort_order': idx,
                'created_at': now,
                'updated_at': now,
            }
            for idx, name in enumerate(DEFAULT_TAGS)
        ],
    )


def downgrade() -> None:
    op.drop_table('user_employee_tags')
    op.drop_index('ix_employee_tags_id', table_name='employee_tags')
    op.drop_table('employee_tags')
