"""Measure the app's size over time, so bug counts can be read against it.

Writes docs/bugs/APP_SIZE.csv: one row per branch per month with
- loc: lines of app code at the branch's month-end commit (what was deployed
  from it at month end). A promotion merge can be staging's latest commit; its
  tree is staging's, so that is still the right snapshot.
- lines_added / lines_removed: churn for the month.
  main: measured first-parent, so it is what reached production that month,
  whether by promotion, hotfix or direct commit.
  staging: every non-merge commit reachable from staging, by commit date, so it
  is all development work as it was written. Staging's first-parent history
  runs through main's promotion merges, which would just repeat main.

The loc snapshot follows the same split: main's last first-parent commit in the
month, staging's latest commit in the month.

App code means backend/app, frontend/src and apps_script, in source files only.
Tests, migrations, caches and vendored files are excluded.

    python scripts/bug_ledger_size.py
"""
import csv
import re
import subprocess
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "docs" / "bugs" / "APP_SIZE.csv"
BRANCHES = ["main", "staging"]
ROOTS = ("backend/app/", "frontend/src/", "apps_script/")
SOURCE = re.compile(r"\.(py|ts|tsx|js|jsx|gs|css|html)$")
EXCLUDE = re.compile(r"(__pycache__|/tests?/|\.test\.|\.spec\.|/alembic/|node_modules)")


def git(*args, input_=None):
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, input=input_,
                          check=True).stdout


def is_app_code(path):
    return path.startswith(ROOTS) and SOURCE.search(path) and not EXCLUDE.search(path)


def loc_at(rev):
    paths = [p for p in git("ls-tree", "-r", "--name-only", rev).decode().splitlines() if is_app_code(p)]
    if not paths:
        return 0, 0
    req = "".join(f"{rev}:{p}\n" for p in paths).encode()
    out = git("cat-file", "--batch", input_=req)
    total, i = 0, 0
    while i < len(out):
        nl = out.index(b"\n", i)
        size = int(out[i:nl].split()[2])
        blob = out[nl + 1: nl + 1 + size]
        total += blob.count(b"\n") + (1 if blob and not blob.endswith(b"\n") else 0)
        i = nl + 1 + size + 1
    return total, len(paths)


def months():
    first = git("log", "--reverse", "--format=%cd", "--date=format:%Y-%m", "main").decode().split()[0]
    last = git("log", "-1", "--format=%cd", "--date=format:%Y-%m", "--all").decode().strip()
    y, m = map(int, first.split("-"))
    out = []
    while f"{y:04d}-{m:02d}" <= last:
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def next_month(ym):
    y, m = map(int, ym.split("-"))
    return f"{y + 1:04d}-01" if m == 12 else f"{y:04d}-{m + 1:02d}"


def churn(branch):
    walk = ["--first-parent", "--diff-merges=first-parent"] if branch == "main" else ["--no-merges"]
    log = git("log", *walk, "--numstat", "--format=@%cd", "--date=format:%Y-%m", branch).decode()
    added, removed, month = defaultdict(int), defaultdict(int), None
    for line in log.splitlines():
        if line.startswith("@"):
            month = line[1:]
            continue
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].isdigit() and is_app_code(parts[2]):
            added[month] += int(parts[0])
            removed[month] += int(parts[1])
    return added, removed


def main():
    rows = []
    for branch in BRANCHES:
        added, removed = churn(branch)
        for ym in months():
            walk = ["--first-parent"] if branch == "main" else ["--date-order"]
            rev = git("rev-list", "-1", *walk, f"--before={next_month(ym)}-01T00:00:00",
                      branch).decode().strip()
            loc, files = loc_at(rev) if rev else (0, 0)
            rows.append({"branch": branch, "month": ym, "rev": rev[:7], "loc": loc, "files": files,
                         "lines_added": added[ym], "lines_removed": removed[ym]})
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print(r)


if __name__ == "__main__":
    main()
