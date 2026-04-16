from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic Config object (reads alembic.ini)
config = context.config

# Logging setup
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---- IMPORTANT: import your app's Base metadata ----
from app.db.session import Base  # noqa: E402
# ---- IMPORTANT: ensure ALL models are imported so Base.metadata is complete ----
# If models aren't imported, Alembic thinks those tables were "removed".
from app.db.models import user  # noqa: F401,E402
from app.db.models import job  # noqa: F401,E402
from app.db.models import event  # noqa: F401,E402
from app.db.models import dvir        # noqa: F401,E402
from app.db.models import job_report  # noqa: F401,E402
# Add any other model modules that define tables:
from app.db import sheet_exports  # noqa: F401,E402  (if this defines Base tables)
target_metadata = Base.metadata


def _get_database_url() -> str:
    """
    Keep Alembic's DB URL consistent with app/db/session.py.
    Prefers DATABASE_URL (PostgreSQL on Render), falls back to SQLite locally.
    """
    url = os.getenv("DATABASE_URL", "")
    if url:
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return url

    # Local dev: SQLite
    sqlite_path = os.getenv("SQLITE_PATH", "./app.db")
    if sqlite_path.startswith("/"):
        return f"sqlite:////{sqlite_path.lstrip('/')}"
    return f"sqlite:///{sqlite_path}"


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.
    """
    url = _get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.
    """
    # Override sqlalchemy.url dynamically so we never hardcode paths/secrets in alembic.ini
    config.set_main_option("sqlalchemy.url", _get_database_url())

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}) or {},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()