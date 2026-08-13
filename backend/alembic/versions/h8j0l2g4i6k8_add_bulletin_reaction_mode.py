"""add bulletin_posts.reaction_mode

Per-post switch between "like" and "dislike" on the Company Bulletin.

NOT NULL with a server_default of 'like', so every existing post keeps behaving
exactly as it does today and no backfill is needed. The server_default is kept in
the schema (not just applied once and dropped) because posts are created by a
best-effort path that has been added to over time; a default in the database is
the thing that cannot be forgotten by a future INSERT.

Downgrade drops the column, which loses which posts were switched. That is
acceptable here: the reaction ROWS live in bulletin_likes and are untouched, so
a downgrade turns every post back into a like post rather than destroying
anything.

Revision ID: h8j0l2g4i6k8
Revises: g7i9k1f3h5j7
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'h8j0l2g4i6k8'
down_revision: Union[str, Sequence[str], None] = 'g7i9k1f3h5j7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'bulletin_posts',
        sa.Column('reaction_mode', sa.String(), nullable=False, server_default='like'),
    )


def downgrade() -> None:
    op.drop_column('bulletin_posts', 'reaction_mode')
