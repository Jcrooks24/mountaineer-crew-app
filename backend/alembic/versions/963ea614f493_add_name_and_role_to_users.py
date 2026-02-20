"""add name and role to users

Revision ID: 963ea614f493
Revises: acb818a08b24
Create Date: 2026-02-19 17:24:19.454428

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '963ea614f493'
down_revision: Union[str, Sequence[str], None] = 'acb818a08b24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Add:
      - users.name (nullable)
      - users.role (NOT NULL, default 'user')
    SQLite requires a server_default when adding a NOT NULL column to a table with existing rows.
    """
    op.add_column("users", sa.Column("name", sa.String(), nullable=True))
    op.add_column(
        "users",
        sa.Column("role", sa.String(), nullable=False, server_default="user"),
    )

    # NOTE: In many DBs we would drop the default after backfilling.
    # SQLite makes altering defaults annoying; leaving it is fine for MVP.


def downgrade() -> None:
    """Remove users.name and users.role"""
    op.drop_column("users", "role")
    op.drop_column("users", "name")