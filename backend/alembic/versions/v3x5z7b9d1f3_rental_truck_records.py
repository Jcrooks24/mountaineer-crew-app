"""rental truck records, their job links, and the DVIR's link to one

Revision ID: v3x5z7b9d1f3
Revises: u2w4y6a8c0e2
Create Date: 2026-09-24

ADR 0053 put the rented truck's identity on the job header, one per job, entered
at job setup. Crew then re-entered the same truck on every job it served, and
every truck option still read "rental", so two rentals out at once could not be
told apart. `rental_trucks` makes each physical rental its own record, entered
once (usually at the pre-trip DVIR) and offered in the truck list as
"Rental*<job name>". `rental_truck_jobs` records every job a truck served.

`dvirs.rental_uuid` says which record an inspection was filed against. The DVIR
keeps its own snapshot of plate, company, agreement and GVWR (ADR 0053), so this
is a link for lookup, not the source of those values.

Additive only. No backfill: rows before this carry no record, and the legacy
`job_setup.rental_json` is still read as a fallback. See ADR 0055.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v3x5z7b9d1f3'
down_revision: Union[str, Sequence[str], None] = 'u2w4y6a8c0e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'rental_trucks',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('rental_uuid', sa.String(), nullable=False),
        sa.Column('unit_name', sa.String(), nullable=False),
        sa.Column('plate', sa.String(), nullable=False),
        sa.Column('plate_key', sa.String(), nullable=False),
        sa.Column('company', sa.String(), nullable=True),
        sa.Column('agreement_number', sa.String(), nullable=True),
        sa.Column('gvwr_lbs', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by_id', sa.Integer(), nullable=True),
        sa.Column('created_by_name', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=False),
        sa.Column('returned_at', sa.DateTime(), nullable=True),
        sa.Column('returned_by_name', sa.String(), nullable=True),
    )
    op.create_index('ix_rental_trucks_id', 'rental_trucks', ['id'])
    op.create_index('ix_rental_trucks_rental_uuid', 'rental_trucks', ['rental_uuid'], unique=True)
    op.create_index('ix_rental_trucks_plate_key', 'rental_trucks', ['plate_key'])
    op.create_index('ix_rental_trucks_last_used_at', 'rental_trucks', ['last_used_at'])

    op.create_table(
        'rental_truck_jobs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('rental_uuid', sa.String(), nullable=False),
        sa.Column('job_uuid', sa.String(), nullable=False),
        sa.Column('job_name', sa.String(), nullable=True),
        sa.Column('job_date', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('linked_by_id', sa.Integer(), nullable=True),
        sa.Column('linked_by_name', sa.String(), nullable=True),
        sa.Column('linked_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('rental_uuid', 'job_uuid', name='uq_rental_truck_jobs_rental_job'),
    )
    op.create_index('ix_rental_truck_jobs_id', 'rental_truck_jobs', ['id'])
    op.create_index('ix_rental_truck_jobs_rental_uuid', 'rental_truck_jobs', ['rental_uuid'])
    op.create_index('ix_rental_truck_jobs_job_uuid', 'rental_truck_jobs', ['job_uuid'])

    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.add_column(sa.Column('rental_uuid', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.drop_column('rental_uuid')

    op.drop_index('ix_rental_truck_jobs_job_uuid', table_name='rental_truck_jobs')
    op.drop_index('ix_rental_truck_jobs_rental_uuid', table_name='rental_truck_jobs')
    op.drop_index('ix_rental_truck_jobs_id', table_name='rental_truck_jobs')
    op.drop_table('rental_truck_jobs')

    op.drop_index('ix_rental_trucks_last_used_at', table_name='rental_trucks')
    op.drop_index('ix_rental_trucks_plate_key', table_name='rental_trucks')
    op.drop_index('ix_rental_trucks_rental_uuid', table_name='rental_trucks')
    op.drop_index('ix_rental_trucks_id', table_name='rental_trucks')
    op.drop_table('rental_trucks')
