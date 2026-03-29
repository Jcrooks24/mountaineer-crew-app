"""alter materials_submissions.total from Float to Numeric(10,2)

Revision ID: h6i7j8k9l0m1
Revises: g5h6i7j8k9l0
Create Date: 2026-03-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h6i7j8k9l0m1'
down_revision: Union[str, Sequence[str], None] = 'g5h6i7j8k9l0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'materials_submissions',
        'total',
        type_=sa.Numeric(precision=10, scale=2),
        existing_type=sa.Float(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'materials_submissions',
        'total',
        type_=sa.Float(),
        existing_type=sa.Numeric(precision=10, scale=2),
        existing_nullable=False,
    )
