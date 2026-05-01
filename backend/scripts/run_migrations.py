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
    python scripts/run_migrations.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT

(assuming Render's Root Directory is set to `backend/`; if not, prefix
the script path with `backend/`.)

Local development: run once after pulling new migrations, then start
uvicorn as usual.

    python scripts/run_migrations.py
    uvicorn app.main:app --reload
"""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path

# Resolve paths absolutely so the script works regardless of cwd or how
# it was invoked. SCRIPT_DIR ends up at backend/scripts, BACKEND_DIR at
# backend, REPO_ROOT at the repo root.
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent

# Make `app.*` importable for alembic's env.py (it does
# `from app.db.session import Base`). prepend_sys_path = . in alembic.ini
# only adds the CWD, which may not be backend/.
sys.path.insert(0, str(BACKEND_DIR))

# Imported after sys.path setup so a fresh-environment install that has
# alembic on PYTHONPATH works the same as one that doesn't.
from alembic.config import Config  # noqa: E402
from alembic import command  # noqa: E402


def main() -> int:
    # Diagnostic header — flushes immediately so any later crash still leaves
    # us breadcrumbs in the Render deploy log. status 2 with no output is
    # a nightmare to debug.
    print(f"[migrations] script:    {__file__}", flush=True)
    print(f"[migrations] cwd:       {os.getcwd()}", flush=True)
    print(f"[migrations] backend:   {BACKEND_DIR}", flush=True)
    print(f"[migrations] python:    {sys.version.split()[0]}", flush=True)

    db_url = os.getenv("DATABASE_URL", "").strip()
    if db_url:
        # Don't leak credentials — log only the host portion.
        host_part = db_url.split("@", 1)[-1].split("/", 1)[0] if "@" in db_url else "(no host)"
        print(f"[migrations] DATABASE_URL: …@{host_part}", flush=True)
    else:
        print("[migrations] WARNING: DATABASE_URL not set — env.py will fall back to SQLite", flush=True)

    alembic_ini = BACKEND_DIR / "alembic.ini"
    if not alembic_ini.exists():
        print(f"[migrations] ERROR: alembic.ini not found at {alembic_ini}", file=sys.stderr, flush=True)
        return 1
    print(f"[migrations] alembic.ini: {alembic_ini}", flush=True)

    try:
        cfg = Config(str(alembic_ini))
        command.upgrade(cfg, "head")
    except Exception:
        print("[migrations] ERROR during alembic upgrade:", file=sys.stderr, flush=True)
        traceback.print_exc()
        return 1

    print("[migrations] Alembic upgrade head — done.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
