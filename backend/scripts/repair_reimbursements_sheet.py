"""One-shot repair for the Reimbursements tab header-overwrite cascade.

Background (see the 2026-08-05 sheet audit): someone typed over A1
(`reimbursement_uuid` -> `dfg`) and C1 (`submitted_at` -> a stray "+"). On the
next export `_ensure_tab` saw those key headers "missing" and re-appended them as
NEW columns (Z = reimbursement_uuid, AA = submitted_at). Legacy rows kept their
uuid in column A; new rows write it to Z. The replace-style delete then looked in
the wrong column, found nothing, and appended without deleting -> 188 duplicate
rows and a ~$17k over-count.

This script UNIFIES the key back into column A, dedupes on it (keeping the latest
`updated_at`), drops the extra Z/AA columns, and restores the A1/C1 headers - in
that order (headers restored LAST, so the newer rows aren't stranded). It backs
the tab up inside the workbook first.

It is idempotent: on an already-clean tab it finds no duplicates and no misplaced
uuids, and (without --apply) writes nothing.

Usage (from repo root or backend/). DATABASE_URL is only needed to read the
Google OAuth token the app stores in SystemConfig - no rows are read from Postgres.

    # Dry-run - analyze + report, write nothing (DEFAULT)
    DATABASE_URL=<prod-postgres-url> \\
      GOOGLE_SHEETS_SPREADSHEET_ID=<sheet-id> \\
      SHEETS_REIMBURSEMENTS_TAB=Reimbursements \\
      python backend/scripts/repair_reimbursements_sheet.py

    # For real (backs up the tab, then rewrites it)
    ... same env ... python backend/scripts/repair_reimbursements_sheet.py --apply
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.integrations.sheets_export import (
    REIMBURSEMENT_HEADERS,
    _api,
    _get_sheets_svc,
    _sheet_ids,
)

# Column layout, from REIMBURSEMENT_HEADERS (25 cols) + the two re-appended ones.
COL_UUID = 0          # A - should be reimbursement_uuid
COL_SUBMITTED = 2     # C - should be submitted_at
COL_AMOUNT = 12       # M
COL_UPDATED = 24      # Y - updated_at
COL_UUID_DUP = 25     # Z - re-appended reimbursement_uuid (where new rows write it)
COL_SUBMITTED_DUP = 26  # AA - re-appended submitted_at
N_HEADERS = len(REIMBURSEMENT_HEADERS)  # 25


def _f(v: str) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="Back up and rewrite the tab. Omit for a dry run.")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        print("error: DATABASE_URL is required (to read the Google OAuth token)", file=sys.stderr)
        sys.exit(1)
    # Required, no default: this is a destructive prod repair, so refuse to run
    # unless the exact workbook is named (the code's DEFAULT_SHEET_ID is a
    # different sheet).
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not spreadsheet_id:
        print("error: GOOGLE_SHEETS_SPREADSHEET_ID is required (the real workbook id)", file=sys.stderr)
        sys.exit(1)
    tab = os.getenv("SHEETS_REIMBURSEMENTS_TAB", "Reimbursements").strip() or "Reimbursements"

    db = sessionmaker(bind=create_engine(db_url))()
    try:
        svc = _get_sheets_svc(db)
    finally:
        db.close()

    ids = _sheet_ids(svc, spreadsheet_id)
    if tab not in ids:
        print(f"error: tab {tab!r} not found in the workbook", file=sys.stderr)
        sys.exit(1)

    values = _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=tab,
    ).execute()).get("values", [])
    if not values:
        print(f"{tab} is empty; nothing to do.")
        return

    header, data = values[0], values[1:]
    width = max(len(header), COL_SUBMITTED_DUP + 1)

    def cell(row, i):
        return row[i] if i < len(row) else ""

    # 1) Unify the key into column A / C, then keep only the 25 real columns.
    misplaced = 0
    unified: list[list[str]] = []
    skipped_blank = 0
    for row in data:
        uuid = cell(row, COL_UUID).strip() or cell(row, COL_UUID_DUP).strip()
        submitted = cell(row, COL_SUBMITTED).strip() or cell(row, COL_SUBMITTED_DUP).strip()
        if not uuid:
            skipped_blank += 1
            continue
        if not cell(row, COL_UUID).strip() and cell(row, COL_UUID_DUP).strip():
            misplaced += 1
        fixed = [cell(row, i) for i in range(N_HEADERS)]
        fixed[COL_UUID] = uuid
        fixed[COL_SUBMITTED] = submitted
        unified.append(fixed)

    # 2) Dedupe by uuid, keeping the row with the latest updated_at; preserve
    #    first-seen order for a stable-looking result.
    best: dict[str, list[str]] = {}
    order: list[str] = []
    for row in unified:
        u = row[COL_UUID]
        if u not in best:
            order.append(u)
            best[u] = row
        elif cell(row, COL_UPDATED) > cell(best[u], COL_UPDATED):
            best[u] = row
    deduped = [best[u] for u in order]

    raw_total = sum(_f(cell(r, COL_AMOUNT)) for r in unified)
    clean_total = sum(_f(cell(r, COL_AMOUNT)) for r in deduped)

    print(f"Tab:                    {tab}  ({len(header)} columns)")
    print(f"Data rows:              {len(data)}")
    print(f"Blank/no-uuid skipped:  {skipped_blank}")
    print(f"Rows with uuid in Z:    {misplaced}  (moved back to A)")
    print(f"Distinct reimbursements {len(deduped)}")
    print(f"Duplicate rows removed: {len(unified) - len(deduped)}")
    print(f"SUM(amount) as-is:      ${raw_total:,.2f}")
    print(f"SUM(amount) deduped:    ${clean_total:,.2f}")
    print(f"Over-count removed:     ${raw_total - clean_total:,.2f}")

    if not args.apply:
        print("\nDRY RUN - nothing written. Re-run with --apply to back up + repair.")
        return

    # 3) Back up the tab inside the workbook (a dated copy) before touching it.
    backup_name = f"{tab}_backup_preRepair"
    if backup_name not in ids:
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"duplicateSheet": {
                "sourceSheetId": ids[tab], "newSheetName": backup_name,
            }}]},
        ).execute())
        print(f"\nBacked up -> {backup_name}")
    else:
        print(f"\nBackup {backup_name} already exists; leaving it.")

    # 4) Clear the tab and rewrite: restored headers (A1/C1 correct) + deduped
    #    rows, at exactly the 25 real columns.
    _api(lambda: svc.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=tab,
    ).execute())
    out = [list(REIMBURSEMENT_HEADERS)] + deduped
    _api(lambda: svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=f"{tab}!A1",
        valueInputOption="RAW", body={"values": out},
    ).execute())

    # 5) Drop the now-empty extra columns (Z, AA, and any beyond 25).
    meta = _api(lambda: svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id, ranges=[tab], fields="sheets(properties(sheetId,gridProperties/columnCount))",
    ).execute())
    grid_cols = N_HEADERS
    for s in meta.get("sheets", []):
        if s["properties"]["sheetId"] == ids[tab]:
            grid_cols = int(s["properties"]["gridProperties"]["columnCount"])
    if grid_cols > N_HEADERS:
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"deleteDimension": {"range": {
                "sheetId": ids[tab], "dimension": "COLUMNS",
                "startIndex": N_HEADERS, "endIndex": grid_cols,
            }}}]},
        ).execute())
        print(f"Trimmed columns {N_HEADERS + 1}..{grid_cols} (dropped Z/AA residue).")

    print(f"\nDone. {tab} now holds {len(deduped)} rows, one per reimbursement, headers restored.")
    print("Re-run the app's Sync & Accuracy audit to confirm zero missing.")


if __name__ == "__main__":
    main()
