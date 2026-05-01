"""Run pending Alembic migrations to head.

Designed to run as the first step of the Render start command, BEFORE
uvicorn launches. This replaces the alembic.upgrade call that used to
live in app.main's on_startup hook — once the migration chain grew past
~24 modules, loading the full alembic + migration import surface
alongside FastAPI in the same process was OOM-killing the web worker
on Render's 512 MB tier.

Running migrations here, in their own short-lived process, lets that
memory be reclaimed before uvicorn boots.

Render Start Command (set in service settings):
    python backend/scripts/run_migrations.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT

Local development: run once after pulling new migrations, then start
uvicorn as usual.

    python backend/scripts/run_migrations.py
    uvicorn app.main:app --reload
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow running from repo root or from backend/.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from alembic.config import Config
from alembic import command


def main() -> None:
    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    if not alembic_ini.exists():
        print(f"error: alembic.ini not found at {alembic_ini}", file=sys.stderr)
        sys.exit(1)

    cfg = Config(str(alembic_ini))
    command.upgrade(cfg, "head")
    print("[migrations] Alembic upgrade head — done.")


if __name__ == "__main__":
    main()
