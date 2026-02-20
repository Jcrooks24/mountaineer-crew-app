"""
Database connection + session management.
This sets up SQLite and provides a session generator for FastAPI.

Key detail:
- Local dev uses ./app.db
- Render prod should use a persistent disk path, e.g. /var/data/app.db via env var SQLITE_PATH
"""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# If SQLITE_PATH is set:
# - local example: C:/crew_app/backend/app.db (works)
# - render example: /var/data/app.db (requires Render Disk mount)
SQLITE_PATH = os.getenv("SQLITE_PATH", "./app.db")

# SQLAlchemy SQLite URL rules:
# - relative path: sqlite:///./app.db
# - absolute unix path: sqlite:////var/data/app.db
# - absolute windows path: sqlite:///C:/path/app.db
if SQLITE_PATH.startswith("/"):
    DATABASE_URL = f"sqlite:////{SQLITE_PATH.lstrip('/')}"
else:
    # for relative paths or Windows absolute paths
    DATABASE_URL = f"sqlite:///{SQLITE_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # required for SQLite + FastAPI threading
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    """
    Dependency for FastAPI routes.
    Opens a DB session and closes it after request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()