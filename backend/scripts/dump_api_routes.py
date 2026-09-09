"""Dump the server's route table for the frontend contract check.

`frontend/scripts/verify_api_contract.mjs` asserts that every `/api/...` URL the
client calls actually exists. It cannot import FastAPI, so the route table is
exported here and checked in as `frontend/scripts/api_routes.json`.

RUN THIS whenever an endpoint is added, removed, or renamed:

    cd backend && python scripts/dump_api_routes.py

Why a checked-in file rather than a live import: the frontend check runs in node
with no Python, no venv and no database, and it has to keep working in CI and on
a laptop where the backend deps are not installed. The cost is that the file can
go stale, which the consuming script warns about by comparing `generated_from`
against HEAD.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The app refuses to boot without these. Values are irrelevant - nothing is
# connected to, we only read the route table off the ASGI app.
os.environ.setdefault("JWT_SECRET", "dump-api-routes")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.main import app  # noqa: E402

OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "scripts", "api_routes.json",
)


def _head() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
        ).stdout.strip()
    except Exception:
        return ""


def main() -> None:
    # openapi() flattens the included routers, which `app.routes` does not on
    # every FastAPI version.
    paths = sorted(app.openapi()["paths"].keys())
    payload = {
        "generated_from": _head(),
        "note": "Regenerate with: cd backend && python scripts/dump_api_routes.py",
        "paths": paths,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(paths)} paths to {OUT}")


if __name__ == "__main__":
    main()
