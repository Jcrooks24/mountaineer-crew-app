"""add worker_leases

Revision ID: g7i9k1f3h5j7
Revises: f6h8j0e2g4i6
Create Date: 2026-08-12

Replaces the auto-reconciler's pg_try_advisory_lock, which is session-scoped and
therefore unreliable through a transaction-mode connection pooler (staging runs
behind Supavisor on :6543; the reconcile cycle commits partway through, after
which the session may be served by a different backend).

A lease is a row, so it is indifferent to pooling, and it expires - a worker
killed mid-sweep releases it by the clock rather than leaving a stranded lock.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g7i9k1f3h5j7'
down_revision: Union[str, Sequence[str], None] = 'f6h8j0e2g4i6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'worker_leases',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('holder', sa.String(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_worker_leases_name', 'worker_leases', ['name'], unique=True)
    op.create_index('ix_worker_leases_expires_at', 'worker_leases', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_worker_leases_expires_at', table_name='worker_leases')
    op.drop_index('ix_worker_leases_name', table_name='worker_leases')
    op.drop_table('worker_leases')
