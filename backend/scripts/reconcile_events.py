"""Reconcile events durable in Postgres but missing from the Events sheet.

The /api/sync path writes to Postgres first and to Google Sheets best-effort.
If the Sheets append fails, the device drops the event from its outbox the
moment the server returns ok=True, and nothing retries — so events stay in
`events` but never land in `sheet_event_exports`.

This script picks them up. It's idempotent: re-running is safe; the existing
dedupe table makes sure nothing is appended twice.

Usage (from repo root or backend/):

    # Dry-run — count only, write nothing
    DATABASE_URL=<staging-postgres-url> \\
      GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id> \\
      SHEETS_EVENTS_TAB=EventsStaging \\
      python backend/scripts/reconcile_events.py --dry-run

    # For real, defaulting to 200/batch and 2000/run
    DATABASE_URL=<staging-postgres-url> \\
      GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id> \\
      SHEETS_EVENTS_TAB=EventsStaging \\
      python backend/scripts/reconcile_events.py

    # Cap explicitly (e.g. nightly cron with a tighter ceiling)
    python backend/scripts/reconcile_events.py --max 5000 --batch 200

Suitable as a Render scheduled job.
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.integrations.sheets_reconcile import (
    count_unexported_events,
    reconcile_events,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Count missing events; write nothing")
    parser.add_argument("--batch", type=int, default=200, help="Events per Sheets append (default 200, max 500)")
    parser.add_argument("--max", type=int, default=2000, help="Max events to reconcile in this run (default 2000, max 10000)")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        print("error: DATABASE_URL env var is required", file=sys.stderr)
        sys.exit(1)

    batch = max(1, min(args.batch, 500))
    cap = max(1, min(args.max, 10000))

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        missing = count_unexported_events(db)
        print(f"Found {missing} event(s) missing from the sheet.")

        if args.dry_run:
            print("Dry run — no changes written.")
            return
        if missing == 0:
            return

        result = reconcile_events(db, batch_size=batch, max_events=cap)
        print(
            f"Reconciled: found={result['found']} exported={result['exported']} "
            f"errors={result['errors']} duration_ms={result['duration_ms']}"
        )
        if result["errors"]:
            sys.exit(2)
    finally:
        db.close()


if __name__ == "__main__":
    main()
