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
    _api,
    _get_sheets_svc,
    _sheet_ids,
)

# The two corrupted headers sit at FIXED physical columns A and C (only their
# header text was overwritten; the data is still there). Every other column is
# resolved BY NAME from the live header row, and the sheet's existing column
# ORDER is preserved (only A1/C1 are fixed and the Z/AA duplicates dropped).
COL_UUID = 0          # A - legacy rows carry reimbursement_uuid here
COL_SUBMITTED = 2     # C - legacy rows carry submitted_at here


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

    def cell(row, i):
        return row[i] if (0 <= i < len(row)) else ""

    def name_idx(name: str) -> int:
        try:
            return header.index(name)
        except ValueError:
            return -1

    # Resolve every real column BY NAME from the live header. The two re-appended
    # duplicates carry their real names (reimbursement_uuid, submitted_at); the
    # legacy copies live at fixed physical A/C under the overwritten header text.
    idx_uuid_dup = name_idx("reimbursement_uuid")   # the re-appended column (Z-ish)
    idx_sub_dup = name_idx("submitted_at")          # the re-appended column (AA-ish)
    idx_amount = name_idx("amount")
    idx_updated = name_idx("updated_at")

    print(f"Tab:                    {tab}  ({len(header)} columns)")
    print(f"Header row (raw):       {header}")
    print(f"amount @ col idx:       {idx_amount}   updated_at @ idx: {idx_updated}   "
          f"reimbursement_uuid(dup) @ idx: {idx_uuid_dup}   submitted_at(dup) @ idx: {idx_sub_dup}")
    if idx_amount < 0:
        print("\nWARNING: no 'amount' column found in the header row - refusing "
              "to proceed (the over-count sanity check can't run). Inspect the "
              "header above; fix the lookup before --apply.", file=sys.stderr)
        sys.exit(2)

    # PRESERVE the sheet's existing column order. Keep every physical column
    # except the two re-appended duplicates; only fix the A1/C1 header text and
    # unify the uuid/submitted_at values back into A/C.
    drop = {i for i in (idx_uuid_dup, idx_sub_dup) if i >= 0}
    keep = [i for i in range(len(header)) if i not in drop]
    out_header = [
        "reimbursement_uuid" if i == COL_UUID else "submitted_at" if i == COL_SUBMITTED else header[i]
        for i in keep
    ]
    up = keep.index(idx_updated) if idx_updated in keep else -1  # updated_at position in the kept row
    am = keep.index(idx_amount)                                   # amount position in the kept row

    def build_kept(row) -> list[str]:
        uuid = cell(row, COL_UUID).strip() or (cell(row, idx_uuid_dup).strip() if idx_uuid_dup >= 0 else "")
        submitted = cell(row, COL_SUBMITTED).strip() or (cell(row, idx_sub_dup).strip() if idx_sub_dup >= 0 else "")
        return [uuid if i == COL_UUID else submitted if i == COL_SUBMITTED else cell(row, i) for i in keep]

    # 1) Unify + keep, skipping rows with no uuid anywhere (phantom/blank residue).
    misplaced = 0
    unified: list[list[str]] = []
    skipped_blank = 0
    for row in data:
        a = cell(row, COL_UUID).strip()
        z = cell(row, idx_uuid_dup).strip() if idx_uuid_dup >= 0 else ""
        if not (a or z):
            skipped_blank += 1
            continue
        if not a and z:
            misplaced += 1
        unified.append(build_kept(row))

    # 2) Dedupe by uuid (kept col 0), keeping the row with the latest updated_at.
    best: dict[str, list[str]] = {}
    order: list[str] = []
    for row in unified:
        u = row[0]
        if u not in best:
            order.append(u)
            best[u] = row
        elif up >= 0 and cell(row, up) > cell(best[u], up):
            best[u] = row
    deduped = [best[u] for u in order]

    raw_total = sum(_f(cell(r, am)) for r in unified)
    clean_total = sum(_f(cell(r, am)) for r in deduped)

    print(f"Data rows:              {len(data)}")
    print(f"Blank/no-uuid skipped:  {skipped_blank}")
    print(f"Rows with uuid in dup:  {misplaced}  (moved back to A)")
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

    # 4) Clear the tab and rewrite: the SAME column order, with A1/C1 headers
    #    restored and the Z/AA duplicate columns dropped, plus deduped rows.
    n_cols = len(out_header)
    _api(lambda: svc.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=tab,
    ).execute())
    out = [out_header] + deduped
    _api(lambda: svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=f"{tab}!A1",
        valueInputOption="RAW", body={"values": out},
    ).execute())

    # 5) Drop the now-empty extra columns (the old Z/AA residue and anything beyond).
    meta = _api(lambda: svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id, ranges=[tab], fields="sheets(properties(sheetId,gridProperties/columnCount))",
    ).execute())
    grid_cols = n_cols
    for s in meta.get("sheets", []):
        if s["properties"]["sheetId"] == ids[tab]:
            grid_cols = int(s["properties"]["gridProperties"]["columnCount"])
    if grid_cols > n_cols:
        _api(lambda: svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"deleteDimension": {"range": {
                "sheetId": ids[tab], "dimension": "COLUMNS",
                "startIndex": n_cols, "endIndex": grid_cols,
            }}}]},
        ).execute())
        print(f"Trimmed columns {n_cols + 1}..{grid_cols} (dropped Z/AA residue).")

    print(f"\nDone. {tab} now holds {len(deduped)} rows, one per reimbursement, headers restored.")
    print("Re-run the app's Sync & Accuracy audit to confirm zero missing.")


if __name__ == "__main__":
    main()
