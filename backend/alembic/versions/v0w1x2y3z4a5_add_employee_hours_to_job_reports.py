"""add employee_hours_json to job_reports

Revision ID: v0w1x2y3z4a5
Revises: u9v0w1x2y3z4
Create Date: 2026-05-08

Adds a JSON-encoded list of per-employee hours entries on each job
report. Each entry is { name, start, end, break_hours, hours }. Stored
as Text following the existing pattern (job_bills.items_json,
materials.items_json) instead of JSONB so SQLite test envs continue
to work without a Postgres-only column type.

Nullable + default null — older reports that predate this column simply
have no employee-hours data attached. The exporter pretty-prints this
field into a single multi-line cell on the JobReports worksheet.
"""
from alembic import op
import sqlalchemy as sa


revision = 'v0w1x2y3z4a5'
down_revision = 'u9v0w1x2y3z4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('job_reports', sa.Column('employee_hours_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('job_reports', 'employee_hours_json')
