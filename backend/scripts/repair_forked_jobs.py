"""Find and repair calendar jobs that forked into two identities.

    python backend/scripts/repair_forked_jobs.py                 # report only
    python backend/scripts/repair_forked_jobs.py --apply         # move the rows
    python backend/scripts/repair_forked_jobs.py --job <uuid>    # one job

## The bug

The canonical `job_uuid` for a calendar event comes from the SERVER, which mints
a random uuid4 and stores it in `calendar_jobs`. When `/api/jobs/resolve` was
unreachable the client fell back to `calEventToJobUuid`, a deterministic FNV hash
of the same event id. The two can never agree, so a device that fell back used a
DIFFERENT identity for the same job - and `job_uuid` is what events, job setup,
materials, BOLs, the report, the bill and a dozen other things key on. Crews
stopped seeing each other's work on that job.

The trigger was routine, not exotic: the backend recycles its worker every 1000
requests by design, and each recycle is a window where that call can fail.

The client side is fixed (it retries, and reuses an already-bound id before
minting a hash). This script is for the jobs that already forked.

## Why detection is exact

The fallback is a pure function of the calendar event id. So for every row in
`calendar_jobs` the orphan twin's uuid can be COMPUTED - there is no guessing,
no fuzzy matching on names or dates, and no chance of moving data between two
jobs that merely look alike. If the computed twin has rows, that is the fork.

`app/core/job_uuid_fallback.py` mirrors the frontend function and the two are
checked against each other. If they ever drift this script reports no forks,
which looks exactly like success - so that check is the important one.

## What it will and will not do

Rows move from the twin onto the canonical uuid. Four tables hold job_uuid
UNIQUE (`admin_entry_status`, `job_bills`, `job_reports`, `job_setup`) and
`manual_jobs` keys on it. Where BOTH sides have a row, the merge is ambiguous -
two job reports for one job, each written by people who could not see the other -
and this refuses to choose. Those are reported for a human, and everything
unambiguous still moves.

**It does not touch the Google Sheet.** Rows already exported under the twin stay
there under the old key. After a repair, re-drive the affected records from
Admin -> Sheet Backfill so the sheet carries the canonical key; the orphan rows
remain and are cleaned by hand.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.job_uuid_fallback import cal_event_to_job_uuid

# Every table that keys on job_uuid, and whether that column is unique/PK.
# Unique tables can collide on merge; plain ones cannot.
TABLES: List[Tuple[str, bool]] = [
    ("admin_entry_status", True),
    ("admin_notes", False),
    ("digital_bols", False),
    ("dvirs", False),
    ("estimates", False),
    ("events", False),
    ("incidents", False),
    ("job_bills", True),
    ("job_checklist_checks", False),
    ("job_inventory_items", False),
    ("job_reports", True),
    ("job_setup", True),
    ("long_distance_days", False),
    ("manual_jobs", True),  # job_uuid is the primary key
    ("materials_submissions", False),
    ("payroll_corrections", False),
    ("photos", False),
    ("prior_on_duty_statements", False),
    ("reimbursements", False),
    ("rods_logs", False),
]

# `calendar_jobs` is deliberately absent: it IS the canonical mapping. Rewriting
# it would move the very definition of which uuid is correct.


def _count(db, table: str, job_uuid: str) -> int:
    return int(db.execute(
        text(f"SELECT COUNT(*) FROM {table} WHERE job_uuid = :u"), {"u": job_uuid},
    ).scalar() or 0)


def find_forks(db, only_job: str | None = None) -> List[Dict]:
    """Every calendar job whose computed twin has rows under it."""
    rows = db.execute(
        text("SELECT calendar_event_id, job_uuid FROM calendar_jobs")
    ).fetchall()
    out: List[Dict] = []
    for cal_id, canonical in rows:
        if not cal_id or not canonical:
            continue
        if only_job and canonical != only_job:
            continue
        twin = cal_event_to_job_uuid(cal_id)
        if twin == canonical:
            continue  # impossible in practice, but never "merge" a job into itself
        per_table: Dict[str, int] = {}
        conflicts: List[str] = []
        for table, unique in TABLES:
            n = _count(db, table, twin)
            if not n:
                continue
            per_table[table] = n
            if unique and _count(db, table, canonical) > 0:
                conflicts.append(table)
        if per_table:
            out.append({
                "calendar_event_id": cal_id,
                "canonical": canonical,
                "twin": twin,
                "tables": per_table,
                "conflicts": conflicts,
            })
    return out


def repair(db, fork: Dict, apply: bool) -> Dict[str, int]:
    """Move the twin's rows onto the canonical uuid. Skips conflicting tables."""
    moved: Dict[str, int] = {}
    for table, _unique in TABLES:
        n = fork["tables"].get(table, 0)
        if not n or table in fork["conflicts"]:
            continue
        if apply:
            db.execute(
                text(f"UPDATE {table} SET job_uuid = :new WHERE job_uuid = :old"),
                {"new": fork["canonical"], "old": fork["twin"]},
            )
        moved[table] = n
    if apply:
        db.commit()
    return moved


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="Actually move the rows. Without this it only reports.")
    ap.add_argument("--job", default=None,
                    help="Repair one canonical job_uuid instead of all.")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        sys.exit("error: DATABASE_URL is required")
    db = sessionmaker(bind=create_engine(db_url))()

    forks = find_forks(db, args.job)
    if not forks:
        print("No forked jobs found.")
        print("(If you expected some, check that app/core/job_uuid_fallback.py still "
              "matches calEventToJobUuid in the frontend - a drift there reports zero.)")
        return

    total_rows = sum(sum(f["tables"].values()) for f in forks)
    print(f"{len(forks)} forked job(s), {total_rows} orphaned row(s).\n")

    moved_total = 0
    blocked: List[Dict] = []
    for f in forks:
        print(f"calendar event {f['calendar_event_id']}")
        print(f"  canonical {f['canonical']}")
        print(f"  orphan    {f['twin']}")
        for table, n in sorted(f["tables"].items()):
            flag = "  <- CONFLICT, not moved" if table in f["conflicts"] else ""
            print(f"    {table:26} {n:5} row(s){flag}")
        moved = repair(db, f, args.apply)
        moved_total += sum(moved.values())
        if f["conflicts"]:
            blocked.append(f)
        print()

    verb = "Moved" if args.apply else "Would move"
    print(f"{verb} {moved_total} row(s) onto their canonical job_uuid.")

    if blocked:
        print(f"\n{len(blocked)} job(s) have CONFLICTS that were left alone:")
        for f in blocked:
            print(f"  {f['canonical']}  ({', '.join(f['conflicts'])})")
        print("  Both identities hold a row in a table that allows only one per job -")
        print("  two job reports for the same job, say, written by people who could")
        print("  not see each other's. Which one is right is a judgement about the")
        print("  work, not about the data, so this will not choose. Resolve by hand,")
        print("  then re-run.")

    if not args.apply:
        print("\nDry run. Nothing was changed. Re-run with --apply to move the rows.")
    else:
        print("\nThe Google Sheet is NOT updated by this script. Rows already exported")
        print("under the orphan uuid still carry the old key. Re-drive the affected")
        print("records from Admin -> Sheet Backfill, then remove the orphan rows by")
        print("hand.")


if __name__ == "__main__":
    main()
