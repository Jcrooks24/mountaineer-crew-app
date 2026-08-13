"""Verify the migration fast path skips only work it has PROVEN is unnecessary.

    python backend/scripts/verify_migration_fastpath.py

The start command runs run_migrations.py on every uvicorn boot, and uvicorn is
recycled every --limit-max-requests (1000) by design. So this script runs on
every worker turnover, not once per deploy, and the service is down while it
runs. It used to load all ninety-plus migration modules to discover there was
nothing to do.

The fast path answers "is anything pending" by reading the version files as TEXT
and running one small query. The ONLY risk that matters is the opposite of a slow
boot: skipping a migration that genuinely needed to run. These checks are almost
entirely about that direction.
"""

import io
import importlib.util
import os
import sys
import tempfile

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


spec = importlib.util.spec_from_file_location(
    "run_migrations", os.path.join(BACKEND, "scripts", "run_migrations.py"))
rm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rm)

print("It agrees with alembic about the head:")
from alembic.config import Config  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402

alembic_head = ScriptDirectory.from_config(
    Config(os.path.join(BACKEND, "alembic.ini"))).get_heads()
fast_head = rm._head_from_files()
check("single head, both ways", len(alembic_head) == 1 and fast_head == alembic_head[0],
      f"fast={fast_head} alembic={alembic_head}")

print("\nIt refuses to answer when the chain is ambiguous:")
# A second head means a branched history. Skipping on a guess there could strand
# a whole branch of migrations unapplied.
real_versions = os.path.join(BACKEND, "alembic", "versions")
with tempfile.TemporaryDirectory() as tmp:
    import shutil
    fake_backend = os.path.join(tmp, "backend")
    shutil.copytree(os.path.join(BACKEND, "alembic"), os.path.join(fake_backend, "alembic"))
    orig = rm.BACKEND_DIR
    from pathlib import Path
    rm.BACKEND_DIR = Path(fake_backend)

    check("baseline still resolves", rm._head_from_files() == fast_head)

    extra = os.path.join(fake_backend, "alembic", "versions", "zz_second_head.py")
    io.open(extra, "w", encoding="utf-8").write(
        "revision: str = 'zzzz_second'\ndown_revision: Union[str, None] = 'h8j0l2g4i6k8'\n")
    check("two heads -> None (falls through to the real upgrade)",
          rm._head_from_files() is None)
    os.remove(extra)

    bad = os.path.join(fake_backend, "alembic", "versions", "zz_unparseable.py")
    io.open(bad, "w", encoding="utf-8").write("# a version file with no revision line\n")
    check("an unparseable version file -> None", rm._head_from_files() is None)
    os.remove(bad)

    check("recovers once the odd files are gone", rm._head_from_files() == fast_head)

    shutil.rmtree(os.path.join(fake_backend, "alembic", "versions"))
    check("a missing versions dir -> None", rm._head_from_files() is None)

    rm.BACKEND_DIR = orig

print("\nIt refuses to answer when the database cannot confirm:")
check("no DATABASE_URL -> None", rm._stamped_revision("") is None)
check("an unreachable database -> None (not a crash, not a skip)",
      rm._stamped_revision("postgresql://nobody@127.0.0.1:1/nothing") is None)
check("a nonsense URL -> None", rm._stamped_revision("not-a-url") is None)

print("\nThe skip is gated on BOTH answers being present and equal:")
src = io.open(os.path.join(BACKEND, "scripts", "run_migrations.py"), encoding="utf-8").read()
check("requires head AND stamped AND equality",
      "if head and stamped and head == stamped:" in src)
check("every other path still calls the real upgrade",
      src.count("command.upgrade(cfg, \"head\")") == 1)
check("the upgrade is not inside the skip branch",
      src.index("if head and stamped and head == stamped:")
      < src.index("command.upgrade(cfg, \"head\")"))
check("boot time is logged either way, so the cost stays visible",
      src.count("time.monotonic()") >= 2 and "ms]" in src)

print("\nThe fast path is actually fast:")
import time  # noqa: E402
t = time.monotonic()
for _ in range(5):
    rm._head_from_files()
ms = (time.monotonic() - t) * 1000 / 5
check("head scan is milliseconds, not hundreds", ms < 60, f"{ms:.1f} ms/call")

print("\nThe request counter the recycle decision needs exists:")
from app.core.limits import REQUESTS_SERVED  # noqa: E402
check("counter importable and starts at zero", REQUESTS_SERVED == [0])
limits_src = io.open(os.path.join(BACKEND, "app", "core", "limits.py"), encoding="utf-8").read()
check("incremented on the HTTP path only",
      "REQUESTS_SERVED[0] += 1" in limits_src
      and limits_src.index('scope["type"] != "http"') < limits_src.index("REQUESTS_SERVED[0] += 1"))

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
