"""One-shot user migration: staging Postgres → production Postgres.

Run immediately before promoting the staging branch to main, so crew
members don't have to re-register. Application data (events, materials,
estimates, DVIRs, bills, photos, …) is NOT copied — that would pollute
production with test noise. The Google Sheet is the authoritative
long-term record; prod starts with its own empty tables for those.

Merge policy: if a crew member's email already exists in prod, the
prod row is left untouched (prod wins — they've been actively using
their prod account). Only staging-only emails are inserted. The
staging row's is_active, role, name, profile_photo, and password_hash
all carry across so the crew member logs in with the same credentials
they've been using on staging.

Safe to re-run: ON CONFLICT (email) DO NOTHING.

Usage:

    # Dry run — prints what would happen, writes nothing
    STAGING_DATABASE_URL=... PROD_DATABASE_URL=... \\
        python backend/scripts/migrate_users_staging_to_prod.py --dry-run

    # For real
    STAGING_DATABASE_URL=... PROD_DATABASE_URL=... \\
        python backend/scripts/migrate_users_staging_to_prod.py

Both URLs must be the full Postgres connection string (Render's
internal URL works). The script does NOT read the app's own config.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List

from sqlalchemy import create_engine, text


COPIED_COLUMNS = [
    "email",
    "password_hash",
    "name",
    "role",
    "is_active",
    "profile_photo",
]
# Not copied: id (let prod auto-assign), reset_token + reset_token_expiry
# (any in-flight staging reset is invalidated at promotion — crew re-request
# if needed).


def fix_postgres_url(url: str) -> str:
    # SQLAlchemy rejects the legacy scheme.
    return url.replace("postgres://", "postgresql://", 1) if url.startswith("postgres://") else url


def fetch_staging_users(url: str) -> List[Dict[str, Any]]:
    engine = create_engine(fix_postgres_url(url))
    with engine.connect() as c:
        result = c.execute(text(f"""
            SELECT {", ".join(COPIED_COLUMNS)}
            FROM users
            ORDER BY email
        """))
        rows = [dict(r._mapping) for r in result]
    engine.dispose()
    return rows


def upsert_into_prod(url: str, rows: List[Dict[str, Any]], dry_run: bool) -> Dict[str, int]:
    engine = create_engine(fix_postgres_url(url))
    stats = {"considered": len(rows), "inserted": 0, "skipped_existing": 0, "errors": 0}

    col_list = ", ".join(COPIED_COLUMNS)
    placeholders = ", ".join(f":{c}" for c in COPIED_COLUMNS)
    # Explicit DO NOTHING on email conflict — prod wins.
    insert_sql = text(f"""
        INSERT INTO users ({col_list})
        VALUES ({placeholders})
        ON CONFLICT (email) DO NOTHING
        RETURNING id
    """)

    with engine.begin() as c:
        # Preload existing emails so we can report skipped explicitly
        existing = {
            r[0]
            for r in c.execute(text("SELECT email FROM users")).fetchall()
        }

        for row in rows:
            email = row["email"]
            if email in existing:
                stats["skipped_existing"] += 1
                print(f"  skip   {email}  (already in prod)")
                continue
            if dry_run:
                stats["inserted"] += 1
                print(f"  would insert  {email}  ({row['role']}, active={row['is_active']})")
                continue
            try:
                res = c.execute(insert_sql, row)
                new_id = res.scalar()
                if new_id is not None:
                    stats["inserted"] += 1
                    print(f"  inserted {email} → id={new_id}")
                else:
                    # ON CONFLICT fired — race with another writer since we
                    # read `existing`. Count as skipped.
                    stats["skipped_existing"] += 1
                    print(f"  skip   {email}  (raced)")
            except Exception as ex:
                stats["errors"] += 1
                print(f"  ERROR  {email}: {ex}")

        if dry_run:
            # Roll back even the read-only transaction to be explicit.
            c.rollback()

    engine.dispose()
    return stats


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dry-run", action="store_true", help="Print planned actions, write nothing.")
    p.add_argument("--staging-url", default=os.getenv("STAGING_DATABASE_URL", ""))
    p.add_argument("--prod-url", default=os.getenv("PROD_DATABASE_URL", ""))
    args = p.parse_args()

    if not args.staging_url:
        print("error: STAGING_DATABASE_URL (or --staging-url) is required", file=sys.stderr)
        return 2
    if not args.prod_url:
        print("error: PROD_DATABASE_URL (or --prod-url) is required", file=sys.stderr)
        return 2
    if args.staging_url == args.prod_url:
        print("error: staging and prod URLs are identical — refusing to run", file=sys.stderr)
        return 2

    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print(f"[{mode}] reading users from staging…")
    staging_rows = fetch_staging_users(args.staging_url)
    print(f"[{mode}] staging has {len(staging_rows)} user(s)")

    print(f"[{mode}] applying to prod…")
    stats = upsert_into_prod(args.prod_url, staging_rows, dry_run=args.dry_run)

    print()
    print("Summary:")
    for k, v in stats.items():
        print(f"  {k:<18} {v}")
    print()
    if args.dry_run:
        print("Dry run complete — no rows written. Re-run without --dry-run to apply.")
    else:
        print("Migration complete. Crew members should be able to log in with existing credentials.")

    return 0 if stats["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
