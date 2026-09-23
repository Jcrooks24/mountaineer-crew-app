#!/usr/bin/env python3
"""Snapshot main and staging into the owner's Obsidian vault after a promotion.

Run it as the post-merge step in docs/PROMOTION_CHECKLIST.md (section 12):

    python scripts/backup_to_vault.py            # fetch, export, verify, prune
    python scripts/backup_to_vault.py --dry-run  # say what it would do

WHY
===
ADR 0054. If the GitHub account or repo were lost or locked, the business still
has every file of what crews run. That is why it runs on every merge to main and
not on every push: the thing worth keeping is each production release.

WHAT IT WRITES
==============
<dest>/<YYYY-MM-DD>_<main sha>/main/      every tracked file at origin/main
<dest>/<YYYY-MM-DD>_<main sha>/staging/   every tracked file at origin/staging
<dest>/<YYYY-MM-DD>_<main sha>/Backup info.md

Tracked files only, from the pushed refs: no git history, no node_modules, and
no local .env files (those hold secrets and must not sync through OneDrive).
Each copy is extracted to a .partial folder, its file count checked against
git, and only then renamed into place. Only after that are old snapshots pruned,
down to the newest --keep (default 5). A folder whose name does not start with a
date is never touched.

<dest> is $CREW_APP_VAULT_BACKUP_DIR, else
~/OneDrive/Desktop/Mountaineer Moving/Crew App Backup.
"""
from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DEST = Path.home() / "OneDrive" / "Desktop" / "Mountaineer Moving" / "Crew App Backup"
SNAPSHOT_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}")
BRANCHES = ("main", "staging")


def git(*args: str) -> bytes:
    return subprocess.run(
        ["git", *args], cwd=REPO, check=True, capture_output=True
    ).stdout


def git_text(*args: str) -> str:
    return git(*args).decode("utf-8").strip()


def tracked_count(ref: str) -> int:
    return len(git_text("ls-tree", "-r", "--name-only", ref).splitlines())


def export(ref: str, target: Path) -> int:
    """Extract every tracked file at ref into target. Returns the file count."""
    target.mkdir(parents=True)
    archive = git("archive", "--format=tar", ref)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(target, filter="data")
    return sum(1 for p in target.rglob("*") if p.is_file())


def prune(dest: Path, keep: int, dry_run: bool, incoming: int = 0) -> list[str]:
    """Delete all but the newest `keep` snapshots. `incoming` counts a snapshot
    a dry run would have added, so its report matches a real run."""
    snapshots = sorted(
        (p for p in dest.iterdir() if p.is_dir() and SNAPSHOT_NAME.match(p.name)),
        key=lambda p: p.name,
    )
    doomed = snapshots[:max(0, len(snapshots) + incoming - keep)]
    for p in doomed:
        if not dry_run:
            shutil.rmtree(p)
    return [p.name for p in doomed]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dest", type=Path,
                    default=Path(os.environ.get("CREW_APP_VAULT_BACKUP_DIR", DEFAULT_DEST)))
    ap.add_argument("--keep", type=int, default=5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.keep < 1:
        print("--keep must be at least 1")
        return 2
    if not args.dest.parent.is_dir():
        print(f"Vault folder not found: {args.dest.parent}")
        print("Set CREW_APP_VAULT_BACKUP_DIR or pass --dest.")
        return 2

    git("fetch", "origin", "--quiet")
    refs = {b: f"origin/{b}" for b in BRANCHES}
    shas = {b: git_text("rev-parse", "--short", r) for b, r in refs.items()}

    # The backup is of what is deployed, so it reads the pushed refs. Say so if
    # this machine holds commits that have not reached GitHub yet.
    for b, r in refs.items():
        try:
            ahead = int(git_text("rev-list", "--count", f"{r}..{b}"))
        except subprocess.CalledProcessError:
            continue
        if ahead:
            print(f"Note: local {b} is {ahead} commit(s) ahead of {r}; "
                  "those are NOT in this backup until pushed.")

    name = f"{date.today().isoformat()}_{shas['main']}"
    final = args.dest / name
    if final.exists():
        print(f"Already backed up: {final}")
        return 0

    if args.dry_run:
        print(f"Would write {final}")
        for b, r in refs.items():
            print(f"  {b}: {r} {shas[b]}, {tracked_count(r)} files")
        if args.dest.is_dir():
            doomed = prune(args.dest, args.keep, dry_run=True, incoming=1)
            print(f"Would prune: {', '.join(doomed) or 'nothing'}")
        return 0

    args.dest.mkdir(exist_ok=True)
    partial = args.dest / f".{name}.partial"
    if partial.exists():
        shutil.rmtree(partial)

    for b, r in refs.items():
        expected = tracked_count(r)
        got = export(r, partial / b)
        if got != expected:
            print(f"FAILED: {b} extracted {got} files, git tracks {expected}. "
                  f"Left for inspection at {partial}; nothing pruned.")
            return 1
        print(f"{b}: {got} files at {shas[b]}, verified")

    lines = [
        f"# Crew app backup, {date.today().isoformat()}",
        "",
        "Snapshot of every tracked file in the mountaineer-crew-app repo "
        "(Jcrooks24/mountaineer-crew-app), one folder per branch, taken at a "
        "merge to main by scripts/backup_to_vault.py (ADR 0054).",
        "",
        "| Folder | Branch | Commit |",
        "|---|---|---|",
    ]
    for b, r in refs.items():
        lines.append(f"| {b} | {r} | "
                     f"{git_text('log', '-1', '--format=%h %ad %s', '--date=short', r)} |")
    lines += [
        "",
        "Not included: git history, untracked files (node_modules, local .env "
        "files with secrets, build output).",
        "",
    ]
    (partial / "Backup info.md").write_text("\n".join(lines), encoding="utf-8")

    partial.rename(final)
    print(f"Wrote {final}")
    doomed = prune(args.dest, args.keep, dry_run=False)
    print(f"Pruned: {', '.join(doomed) or 'nothing'} (keeping newest {args.keep})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
