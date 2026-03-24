"""
Database connection + session management.

Production (Render): set DATABASE_URL to the Render PostgreSQL internal URL.
Local dev: falls back to SQLite (./app.db) when DATABASE_URL is not set.
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "")

if DATABASE_URL:
    # Render provides postgres:// but SQLAlchemy 1.4+ requires postgresql://
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(DATABASE_URL)
else:
    # Local dev: SQLite
    SQLITE_PATH = os.getenv("SQLITE_PATH", "./app.db")
    if SQLITE_PATH.startswith("/"):
        sqlite_url = f"sqlite:////{SQLITE_PATH.lstrip('/')}"
    else:
        sqlite_url = f"sqlite:///{SQLITE_PATH}"
    engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """Dependency for FastAPI routes — opens a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
