"""add job_reports.variance_direction and variance_cause_identified

Both were previously INFERRED on the client from the causes list, and both
inferences were lossy in ways that showed the office something nobody entered:

- direction defaulted to "more" when it could not be told from the stored
  causes, so a report whose only cause was "Other" claimed the job ran LONG.
- "no causes ticked" had to stand for three different situations: nobody has
  filled this in, the crew answered No it did not differ, and the crew looked
  and cannot name a reason. An estimator needs to tell those apart.

Both nullable with no default and no backfill. NULL means "not answered", which
is the truth for every report written before this and is exactly the state the
old inference could not express. Backfilling a direction from the existing causes
would recreate the guess this migration exists to remove.

Revision ID: i9k1m3h5j7l9
Revises: h8j0l2g4i6k8
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'i9k1m3h5j7l9'
down_revision: Union[str, Sequence[str], None] = 'h8j0l2g4i6k8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('variance_direction', sa.String(), nullable=True))
    op.add_column('job_reports', sa.Column('variance_cause_identified', sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'variance_cause_identified')
    op.drop_column('job_reports', 'variance_direction')
