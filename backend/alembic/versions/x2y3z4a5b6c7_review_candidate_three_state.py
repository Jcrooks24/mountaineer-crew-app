"""convert job_reports.review_candidate from boolean to 3-state string

Revision ID: x2y3z4a5b6c7
Revises: w1x2y3z4a5b6
Create Date: 2026-05-09

Crew can now answer the "review candidate" question with N/A in addition
to Yes/No (some clients are obviously not review-targets and forcing a
binary felt arbitrary). Convert the column from Boolean NOT NULL to
String NOT NULL with values 'yes' / 'no' / 'na'. Existing True backfills
to 'yes', False to 'no'. Downgrade collapses 'na' back to False since
boolean has no third state.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x2y3z4a5b6c7'
down_revision: Union[str, Sequence[str], None] = 'w1x2y3z4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'job_reports',
        'review_candidate',
        type_=sa.String(length=8),
        existing_type=sa.Boolean(),
        existing_nullable=False,
        postgresql_using="CASE WHEN review_candidate THEN 'yes' ELSE 'no' END",
    )


def downgrade() -> None:
    op.alter_column(
        'job_reports',
        'review_candidate',
        type_=sa.Boolean(),
        existing_type=sa.String(length=8),
        existing_nullable=False,
        postgresql_using="(review_candidate = 'yes')",
    )
