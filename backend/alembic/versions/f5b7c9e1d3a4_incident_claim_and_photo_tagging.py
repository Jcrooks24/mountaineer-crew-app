"""incident claim numbers + photo incident tagging

Revision ID: f5b7c9e1d3a4
Revises: e4a6c8b0d2f3
Create Date: 2026-07-07

Incidents now carry a human-readable claim_number (client-generated at submit,
offline-safe). Photos can be tagged to an incident (incident_uuid + a denormalized
claim_number) so incident documentation photos are linked to the incident they
document, and admin can find them in Drive by claim number.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f5b7c9e1d3a4'
down_revision: Union[str, Sequence[str], None] = 'e4a6c8b0d2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("incidents", sa.Column("claim_number", sa.String(), nullable=True))
    op.add_column("photos", sa.Column("incident_uuid", sa.String(), nullable=True))
    op.add_column("photos", sa.Column("claim_number", sa.String(), nullable=True))
    op.create_index("ix_photos_incident_uuid", "photos", ["incident_uuid"])


def downgrade() -> None:
    op.drop_index("ix_photos_incident_uuid", table_name="photos")
    op.drop_column("photos", "claim_number")
    op.drop_column("photos", "incident_uuid")
    op.drop_column("incidents", "claim_number")
