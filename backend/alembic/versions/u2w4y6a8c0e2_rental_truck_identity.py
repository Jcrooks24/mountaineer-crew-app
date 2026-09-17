"""rental truck identity on the job header and the DVIR

Revision ID: u2w4y6a8c0e2
Revises: t1v3x5z7b9d1
Create Date: 2026-09-17

A fleet-registry entry named "rental" is a placeholder reused across every truck
we ever hire, and current practice files every rental job against it. So the
DVIR, the RODS and the BOL all recorded the vehicle as the word "rental", and
nothing in the app said which physical truck any of them described. The same
entry also meant one shared inspection history: an unresolved defect on a truck
handed back weeks ago would lock out an unrelated truck, and a clean report on
that old truck would clear a defective one.

`job_setups.rental_json` holds the actual truck for a job: company, agreement
number, plate, GVWR, notes. The DVIR columns are a SNAPSHOT of that at submit,
not a pointer, so a report stays true to the truck it inspected even if the
header is edited later.

`gvwr_lbs` matters on its own: it is the only place the app ever records the
weight rating that decides whether federal rules reached a trip at all.

All nullable with no backfill. Existing rows predate the practice of capturing
this, and inventing a plate for them would be worse than leaving them honest
about what was recorded. See ADR 0053.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u2w4y6a8c0e2'
down_revision: Union[str, Sequence[str], None] = 't1v3x5z7b9d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('job_setups') as batch_op:
        batch_op.add_column(sa.Column('rental_json', sa.Text(), nullable=True))

    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.add_column(sa.Column('vehicle_identifier', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('rental_company', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('rental_agreement', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('gvwr_lbs', sa.Integer(), nullable=True))

    # The prior-report review and the out-of-service lockout both query by
    # (vehicle_number, vehicle_identifier) now, and that runs on the DVIR form
    # every time a unit is picked. The table only grows.
    op.create_index(
        'ix_dvirs_vehicle_number_identifier',
        'dvirs',
        ['vehicle_number', 'vehicle_identifier'],
    )


def downgrade() -> None:
    op.drop_index('ix_dvirs_vehicle_number_identifier', table_name='dvirs')

    with op.batch_alter_table('dvirs') as batch_op:
        batch_op.drop_column('gvwr_lbs')
        batch_op.drop_column('rental_agreement')
        batch_op.drop_column('rental_company')
        batch_op.drop_column('vehicle_identifier')

    with op.batch_alter_table('job_setups') as batch_op:
        batch_op.drop_column('rental_json')
