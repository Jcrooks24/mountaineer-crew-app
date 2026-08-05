"""bulletin post images stored server-side (bytes), not Drive

Revision ID: e8f0a2c4b6d8
Revises: d6e8f0a2c4b6
Create Date: 2026-08-05

Bulletin photos are server-only and transient (no Drive backup), so store the
(client-resized) image bytes + mime on the post and serve them from a capability
URL keyed by the post UUID. The old image_drive_* columns stay for any posts
already created that way; new posts use these.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8f0a2c4b6d8'
down_revision: Union[str, Sequence[str], None] = 'd6e8f0a2c4b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bulletin_posts', sa.Column('image_bytes', sa.LargeBinary(), nullable=True))
    op.add_column('bulletin_posts', sa.Column('image_mime', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('bulletin_posts', 'image_mime')
    op.drop_column('bulletin_posts', 'image_bytes')
