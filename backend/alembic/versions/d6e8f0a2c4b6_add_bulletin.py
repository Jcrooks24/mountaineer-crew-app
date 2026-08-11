"""add company bulletin tables

Revision ID: d6e8f0a2c4b6
Revises: c5e7f9b1d3a5
Create Date: 2026-08-05

Company Bulletin (community feed): posts (photo / link / text), likes, and
comments. Posts and comments carry a client-minted UUID for idempotency; likes
are unique per (post, user). Moderation is a soft removal (removed_at). No sheet
export - this is a community tool, not a system-of-record.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6e8f0a2c4b6'
down_revision: Union[str, Sequence[str], None] = 'c5e7f9b1d3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bulletin_posts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('post_uuid', sa.String(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('author_name', sa.String(), nullable=False, server_default=''),
        sa.Column('kind', sa.String(), nullable=False, server_default='text'),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('image_drive_file_id', sa.String(), nullable=True),
        sa.Column('image_drive_url', sa.String(), nullable=True),
        sa.Column('image_thumb_url', sa.String(), nullable=True),
        sa.Column('link_url', sa.String(), nullable=True),
        sa.Column('link_title', sa.String(), nullable=True),
        sa.Column('link_description', sa.Text(), nullable=True),
        sa.Column('link_image_url', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('removed_at', sa.DateTime(), nullable=True),
        sa.Column('removed_by', sa.String(), nullable=True),
    )
    op.create_index('ix_bulletin_posts_post_uuid', 'bulletin_posts', ['post_uuid'], unique=True)
    op.create_index('ix_bulletin_posts_created_at', 'bulletin_posts', ['created_at'])
    op.create_index('ix_bulletin_posts_author_id', 'bulletin_posts', ['author_id'])

    op.create_table(
        'bulletin_likes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_bulletin_like'),
    )
    op.create_index('ix_bulletin_likes_post_id', 'bulletin_likes', ['post_id'])
    op.create_index('ix_bulletin_likes_user_id', 'bulletin_likes', ['user_id'])

    op.create_table(
        'bulletin_comments',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('comment_uuid', sa.String(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('author_id', sa.Integer(), nullable=True),
        sa.Column('author_name', sa.String(), nullable=False, server_default=''),
        sa.Column('text', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('removed_at', sa.DateTime(), nullable=True),
        sa.Column('removed_by', sa.String(), nullable=True),
    )
    op.create_index('ix_bulletin_comments_comment_uuid', 'bulletin_comments', ['comment_uuid'], unique=True)
    op.create_index('ix_bulletin_comments_post_id', 'bulletin_comments', ['post_id'])


def downgrade() -> None:
    op.drop_table('bulletin_comments')
    op.drop_table('bulletin_likes')
    op.drop_index('ix_bulletin_posts_author_id', table_name='bulletin_posts')
    op.drop_index('ix_bulletin_posts_created_at', table_name='bulletin_posts')
    op.drop_index('ix_bulletin_posts_post_uuid', table_name='bulletin_posts')
    op.drop_table('bulletin_posts')
