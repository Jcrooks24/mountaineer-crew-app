"""seed Crew Lead tag

Revision ID: i3d4e5f6g7h8
Revises: h2c3d4e5f6g7
Create Date: 2026-06-10

Adds the "Crew Lead" tag to the employee_tags table if it isn't already
there. The Crew Resources calendar event groups available crew by tier
and calls out leads separately — this tag is the single source of truth
for who's a lead.

Idempotent: if admin already created a "Crew Lead" tag manually after the
initial deploy, this migration leaves it alone.
"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i3d4e5f6g7h8'
down_revision: Union[str, Sequence[str], None] = 'h2c3d4e5f6g7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = conn.execute(
        sa.text("SELECT 1 FROM employee_tags WHERE name = :n"),
        {"n": "Crew Lead"},
    ).scalar()
    if existing:
        return
    # Sort order = current max + 1 so the tag lands at the end of the list
    # rather than disrupting whatever ordering admin has set up.
    max_order = conn.execute(
        sa.text("SELECT COALESCE(MAX(sort_order), -1) FROM employee_tags")
    ).scalar()
    now = datetime.now(timezone.utc)
    conn.execute(
        sa.text(
            "INSERT INTO employee_tags (name, sort_order, created_at, updated_at) "
            "VALUES (:n, :o, :c, :u)"
        ),
        {"n": "Crew Lead", "o": (max_order or -1) + 1, "c": now, "u": now},
    )


def downgrade() -> None:
    op.execute("DELETE FROM employee_tags WHERE name = 'Crew Lead'")
