"""
Skill registry + per-employee skill levels.

`Skill` is the admin-configurable list of skill types (seeded from the crew
skills tracker: 22 skills across 4 categories). `UserSkill` holds each
employee's 0-5 proficiency per skill (the roster matrix), set by admin in
Settings. The Job Report rates only the skills relevant to a job's type(s)
(core skills, plus skills whose relevant_job_types intersect the job tags).
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from app.db.session import Base


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), unique=True, nullable=False)

    # One of the four rubric categories (free text so admin can add more).
    category = Column(String(64), nullable=False, default="")

    # Binary skills are trained/not-trained (0 or 5) rather than a 0-5 scale.
    binary = Column(Boolean, nullable=False, default=False)

    # Core skills are always shown to rate on the Job Report regardless of job
    # type. Non-core skills only appear when the job's type(s) intersect
    # relevant_job_types.
    core = Column(Boolean, nullable=False, default=False)

    # JSON array of job-type tag names this skill is relevant to. Empty +
    # core=false means the skill is matrix-only (never auto-shown on a report).
    relevant_job_types = Column(Text, nullable=False, default="[]")

    # Optional rubric text (what the ratings mean).
    definition = Column(Text, nullable=True)

    sort_order = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False)


class UserSkill(Base):
    __tablename__ = "user_skills"

    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    skill_id = Column(
        Integer, ForeignKey("skills.id", ondelete="CASCADE"), primary_key=True
    )
    # 0-5 proficiency (0 = none/very poor, 5 = mastery). For binary skills,
    # 0 or 5.
    level = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False)
