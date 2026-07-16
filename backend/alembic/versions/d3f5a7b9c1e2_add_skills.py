"""add skills + user_skills tables (crew skills matrix)

Revision ID: d3f5a7b9c1e2
Revises: c2e4f6a8b0d1
Create Date: 2026-07-06

Seeds the 22 skills from the crew skills tracker (4 categories). Binary skills
are 0/5; the rest 0-5. `core` skills always show on the Job Report;
relevant_job_types gates the others by job type.
"""
from typing import Sequence, Union
from datetime import datetime, timezone
import json

from alembic import op
import sqlalchemy as sa


revision: str = 'd3f5a7b9c1e2'
down_revision: Union[str, Sequence[str], None] = 'c2e4f6a8b0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, category, binary, core, relevant_job_types)
CAT_PT = "Physical / Technical"
CAT_CJ = "Cognitive / Judgment"
CAT_LI = "Leadership / Interpersonal"
CAT_RA = "Reliability / Admin"

SEED = [
    ("Packing", CAT_PT, False, False, ["Packing", "Unpacking"]),
    ("Assembly / Handiness", CAT_PT, False, True, []),
    ("Carefulness", CAT_PT, False, True, []),
    ("Speed / Hustle", CAT_PT, False, True, []),
    ("Truck Driving", CAT_PT, True, False, ["Local", "Long-distance", "Delivery"]),
    ("Art Hanging / Handling", CAT_PT, False, False, []),
    ("Piano Moving", CAT_PT, True, False, []),
    ("Hot Tub Moving", CAT_PT, True, False, []),
    ("Safe Moving", CAT_PT, True, False, []),
    ("Misc Specialty", CAT_PT, True, False, ["Commercial"]),
    ("Problem Solving", CAT_CJ, False, True, []),
    ("Estimate Adjustment", CAT_CJ, False, False, []),
    ("Navigation / Route", CAT_CJ, False, False, ["Long-distance"]),
    ("Long-Distance Capable", CAT_CJ, True, False, ["Long-distance"]),
    ("Long-Distance Skill", CAT_CJ, False, False, ["Long-distance"]),
    ("Client Management", CAT_LI, False, True, []),
    ("Crew Leadership", CAT_LI, False, True, []),
    ("Resourcefulness", CAT_LI, False, True, []),
    ("Availability Accuracy", CAT_RA, False, False, []),
    ("App Usage", CAT_RA, False, False, []),
    ("Submits Receipts", CAT_RA, True, False, []),
    ("Has MM Card", CAT_RA, True, False, []),
]


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False, unique=True),
        sa.Column("category", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("binary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("core", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("relevant_job_types", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("definition", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "user_skills",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("skill_id", sa.Integer(), sa.ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    now = datetime.now(timezone.utc)
    op.bulk_insert(
        sa.table(
            "skills",
            sa.column("name", sa.String),
            sa.column("category", sa.String),
            sa.column("binary", sa.Boolean),
            sa.column("core", sa.Boolean),
            sa.column("relevant_job_types", sa.Text),
            sa.column("sort_order", sa.Integer),
            sa.column("active", sa.Boolean),
            sa.column("created_at", sa.DateTime),
            sa.column("updated_at", sa.DateTime),
        ),
        [
            {
                "name": name,
                "category": cat,
                "binary": binary,
                "core": core,
                "relevant_job_types": json.dumps(rel),
                "sort_order": i,
                "active": True,
                "created_at": now,
                "updated_at": now,
            }
            for i, (name, cat, binary, core, rel) in enumerate(SEED)
        ],
    )


def downgrade() -> None:
    op.drop_table("user_skills")
    op.drop_table("skills")
