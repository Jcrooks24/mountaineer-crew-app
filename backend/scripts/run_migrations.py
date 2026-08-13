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
import re
import sys
import time
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


# ─────────────────────────────────────────────────────────────────────────────
# Fast path: is the database already at head?
#
# THIS IS NOT A DEPLOY OPTIMISATION, IT IS AN UPTIME ONE. The start command runs
# on every uvicorn boot, and uvicorn is recycled every --limit-max-requests
# (1000) BY DESIGN. So this script does not run once per deploy, it runs every
# time the worker turns over - which on a busy afternoon is often, because
# opening a single job costs about twenty requests.
#
# On every one of those the old code loaded all ninety-plus migration modules,
# connected, discovered there was nothing to do, and exited. The service is DOWN
# for that whole window, and crews feel it as the app hanging for no reason.
#
# The check below answers "is anything pending" WITHOUT importing alembic or the
# migration modules: a regex scan of the version files to find the head, and one
# tiny SQL query for the stamped revision. Both are milliseconds.
#
# IT FAILS SAFE. Anything ambiguous - more than one head, an unreadable file, no
# alembic_version table, a stamped revision the files do not mention, any error
# at all - falls through to the real `alembic upgrade head`. The fast path can
# only ever SKIP work it has positively proven is unnecessary; it can never
# decide a pending migration should not run.
# ─────────────────────────────────────────────────────────────────────────────

_REV_RE = re.compile(r"^revision(?::\s*[^=]+)?\s*=\s*['\"]([^'\"]+)['\"]", re.M)
_DOWN_RE = re.compile(r"^down_revision(?::\s*[^=]+)?\s*=\s*['\"]([^'\"]+)['\"]", re.M)


def _head_from_files() -> str | None:
    """The single head revision, by reading the version files as TEXT.

    Returns None whenever the answer is not unambiguous, which sends the caller
    down the real upgrade path.
    """
    versions = BACKEND_DIR / "alembic" / "versions"
    if not versions.is_dir():
        return None
    revisions: set[str] = set()
    downs: set[str] = set()
    try:
        for path in versions.glob("*.py"):
            text = path.read_text(encoding="utf-8")
            rev = _REV_RE.search(text)
            if not rev:
                # A version file we cannot parse means our picture is
                # incomplete, so we are not entitled to skip anything.
                return None
            revisions.add(rev.group(1))
            down = _DOWN_RE.search(text)
            if down:
                downs.add(down.group(1))
    except OSError:
        return None
    heads = revisions - downs
    # Exactly one head, or we do not understand the chain well enough to skip.
    return next(iter(heads)) if len(heads) == 1 else None


def _stamped_revision(db_url: str) -> str | None:
    """The revision Postgres currently reports, or None if unknowable."""
    if not db_url:
        return None
    try:
        from sqlalchemy import create_engine, text
        engine = create_engine(db_url, pool_pre_ping=False)
        try:
            with engine.connect() as conn:
                rows = conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
        finally:
            engine.dispose()
        # Multiple rows means a branched history; let alembic deal with it.
        return rows[0][0] if len(rows) == 1 else None
    except Exception:
        # No table yet (first ever boot), unreachable DB, permissions - all of
        # these are the real upgrade's problem to report, not ours to guess at.
        return None


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

    started = time.monotonic()

    # Fast path. See the block comment above: this runs on every worker recycle,
    # not just on deploys, and the service is unavailable for its duration.
    head = _head_from_files()
    stamped = _stamped_revision(db_url) if head else None
    if head and stamped and head == stamped:
        print(
            f"[migrations] already at head ({head}) - nothing to do "
            f"[{(time.monotonic() - started) * 1000:.0f} ms]",
            flush=True,
        )
        return 0
    if head and stamped and head != stamped:
        print(f"[migrations] at {stamped}, head is {head} - upgrading", flush=True)
    else:
        # Not a failure: a first boot, an unreachable DB, or a chain we could not
        # read as text. Say which is happening so a slow boot is explainable.
        print(
            f"[migrations] cannot confirm current revision "
            f"(head={head or 'unknown'}, stamped={stamped or 'unknown'}) - running full upgrade",
            flush=True,
        )

    try:
        cfg = Config(str(alembic_ini))
        command.upgrade(cfg, "head")
    except Exception:
        print("[migrations] ERROR during alembic upgrade:", file=sys.stderr, flush=True)
        traceback.print_exc()
        return 1

    # Timed so the cost of a boot is visible in the Render log rather than
    # inferred from how long the gap between lines looks.
    print(
        f"[migrations] Alembic upgrade head - done "
        f"[{(time.monotonic() - started) * 1000:.0f} ms]",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
