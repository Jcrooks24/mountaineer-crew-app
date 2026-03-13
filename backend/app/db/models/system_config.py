"""
Key-value store for system-level config (e.g. OAuth tokens that need to survive restarts).
"""
from sqlalchemy import Column, String, Text
from app.db.session import Base


class SystemConfig(Base):
    __tablename__ = "system_config"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)
