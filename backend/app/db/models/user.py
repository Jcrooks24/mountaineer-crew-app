"""
User model for authentication.
Minimal fields for now + minimal RBAC stub.
"""

from sqlalchemy import Column, Integer, String, Boolean
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)

    # New fields (Phase A / Track 2)
    name = Column(String, nullable=True)
    role = Column(String, nullable=False, default="user")

    is_active = Column(Boolean, default=True, nullable=False)