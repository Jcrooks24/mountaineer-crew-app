"""add user_email_aliases table

Revision ID: k5f6g7h8i9j0
Revises: j4e5f6g7h8i9
Create Date: 2026-06-11

Crew members can have alternate email addresses. Aliases live here so
the auth + Postmark flows stay simple (they keep using users.email),
while Crew Resources can resolve a Google Calendar attendee email to
the right user even when the office invited an alias.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k5f6g7h8i9j0'
down_revision: Union[str, Sequence[str], None] = 'j4e5f6g7h8i9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_email_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', name='uq_user_email_aliases_email'),
    )
    op.create_index('ix_user_email_aliases_id', 'user_email_aliases', ['id'])
    op.create_index('ix_user_email_aliases_user_id', 'user_email_aliases', ['user_id'])
    op.create_index('ix_user_email_aliases_email', 'user_email_aliases', ['email'])


def downgrade() -> None:
    op.drop_index('ix_user_email_aliases_email', table_name='user_email_aliases')
    op.drop_index('ix_user_email_aliases_user_id', table_name='user_email_aliases')
    op.drop_index('ix_user_email_aliases_id', table_name='user_email_aliases')
    op.drop_table('user_email_aliases')
