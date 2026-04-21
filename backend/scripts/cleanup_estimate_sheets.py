"""One-shot cleanup: remove duplicate Estimate / EstimateItem rows from Sheets.

The old export logic used (estimate_uuid, updated_at) as a dedup key, which
meant every item-add or patch triggered a brand-new set of rows. Running this
script re-exports every estimate using the new replace strategy, so the sheet
ends up with exactly 1 summary row and 1 row per item per estimate.

The script is idempotent: running it twice has no additional effect.

Usage (run from the repo root or the backend/ directory):

    # Dry-run — shows what would be processed, writes nothing
    DATABASE_URL=<your-staging-postgres-url> \\
      GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id> \\
      SHEETS_ESTIMATES_TAB=EstimatesStaging \\
      SHEETS_ESTIMATE_ITEMS_TAB=EstimateItemsStaging \\
      python backend/scripts/cleanup_estimate_sheets.py --dry-run

    # For real
    DATABASE_URL=<your-staging-postgres-url> \\
      GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id> \\
      SHEETS_ESTIMATES_TAB=EstimatesStaging \\
      SHEETS_ESTIMATE_ITEMS_TAB=EstimateItemsStaging \\
      python backend/scripts/cleanup_estimate_sheets.py

The DATABASE_URL and sheet env vars are the same ones the staging backend uses.
GOOGLE_SHEETS_SPREADSHEET_ID defaults to the shared sheet id already in the code.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

# Allow running from backend/ or from repo root.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.models.estimate import Estimate
from app.integrations.sheets_export import export_estimate_to_sheets


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print estimates that would be re-exported; write nothing")
    args = parser.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        print("error: DATABASE_URL env var is required", file=sys.stderr)
        sys.exit(1)

    engine = create_engine(db_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        estimates = db.query(Estimate).order_by(Estimate.created_at.asc()).all()
        total = len(estimates)
        print(f"Found {total} estimate(s) to process.")

        if args.dry_run:
            for e in estimates:
                print(f"  [dry-run] would re-export {e.estimate_uuid}  customer={e.customer_name!r}  items={len(e.items)}")
            print("Dry run complete — no changes written.")
            return

        for i, e in enumerate(estimates, 1):
            payload = {
                "estimate_uuid": e.estimate_uuid,
                "created_by_name": e.created_by_name,
                "customer_name": e.customer_name,
                "customer_email": e.customer_email,
                "customer_phone": e.customer_phone,
                "move_date": e.move_date,
                "origin_address": e.origin_address,
                "destination_address": e.destination_address,
                "origin_access_notes": e.origin_access_notes,
                "destination_access_notes": e.destination_access_notes,
                "special_items_notes": e.special_items_notes,
                "general_notes": e.general_notes,
                "estimated_weight_lbs": e.estimated_weight_lbs,
                "estimated_cubic_ft": e.estimated_cubic_ft,
                "created_at": e.created_at,
                "updated_at": e.updated_at,
                "items": [
                    {
                        "id": it.id,
                        "name": it.name,
                        "qty": it.qty,
                        "weight_lbs": it.weight_lbs,
                        "cubic_ft": it.cubic_ft,
                        "room": it.room,
                        "subcategory": it.subcategory,
                        "notes": it.notes,
                    }
                    for it in e.items
                ],
            }

            try:
                written = export_estimate_to_sheets(db, payload)
                print(f"[{i}/{total}] {e.estimate_uuid}  customer={e.customer_name!r}  items={len(e.items)}  rows_written={written}")
            except Exception as exc:
                print(f"[{i}/{total}] ERROR on {e.estimate_uuid}: {exc}", file=sys.stderr)

            # Brief pause between estimates to avoid Sheets API rate limits.
            if i < total:
                time.sleep(1.5)

        print("Cleanup complete.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
