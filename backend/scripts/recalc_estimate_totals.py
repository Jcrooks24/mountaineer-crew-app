"""One-shot: recompute estimate rolled-up totals from their items.

Why this exists
---------------
`POST /api/estimates/{uuid}/items` used to do:

    db.add(item); db.flush(); e.items.append(item); _recalc_totals(e)

`items` is a lazy relationship, so after the flush the first touch of `e.items`
loads from the DB and ALREADY contains the new row. The manual `.append()` then
put the same object in the list a second time, and `_recalc_totals` sums the
list. The INSERT was fine (one row, same PK), so item counts were always right
and nobody noticed - but the persisted `estimated_weight_lbs` and
`estimated_cubic_ft` came out inflated by exactly the last-added item's
contribution (qty x weight, qty x cubic_ft).

Editing or deleting any item recalculated correctly and healed the estimate, so
only estimates whose items were ONLY ever added carry a bad total.

This script recomputes every estimate's totals from its items, which is exactly
what `_recalc_totals` does. Idempotent: safe to run repeatedly, and a no-op once
totals are correct.

Usage
-----
    DATABASE_URL=...  python backend/scripts/recalc_estimate_totals.py --dry-run
    DATABASE_URL=...  python backend/scripts/recalc_estimate_totals.py

Run it per environment (staging and prod have separate databases).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal  # noqa: E402
from app.db.models.estimate import Estimate  # noqa: E402,F401  (registers EstimateItem too)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        estimates = db.query(Estimate).all()
        drifted = 0

        for e in estimates:
            want_w = float(sum((it.weight_lbs or 0) * (it.qty or 0) for it in e.items))
            want_c = float(sum((it.cubic_ft or 0) * (it.qty or 0) for it in e.items))
            have_w = float(e.estimated_weight_lbs or 0)
            have_c = float(e.estimated_cubic_ft or 0)

            # Float tolerance: these are sums of floats, so an exact compare
            # would flag harmless representation noise as drift.
            if abs(have_w - want_w) < 0.01 and abs(have_c - want_c) < 0.01:
                continue

            drifted += 1
            print(
                f"{e.estimate_uuid}  ({e.customer_name}, {len(e.items)} items)\n"
                f"    weight  {have_w:>10.1f} -> {want_w:>10.1f}\n"
                f"    cubic   {have_c:>10.1f} -> {want_c:>10.1f}"
            )
            if not args.dry_run:
                e.estimated_weight_lbs = want_w
                e.estimated_cubic_ft = want_c

        if args.dry_run:
            print(f"\nDRY RUN. {drifted} of {len(estimates)} estimates would be corrected.")
        else:
            db.commit()
            print(f"\nCorrected {drifted} of {len(estimates)} estimates.")
        print("Re-export any corrected estimate to refresh its Sheet row (edit + save, or POST an item).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
