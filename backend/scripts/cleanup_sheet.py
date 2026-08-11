"""One-shot Google Sheet housekeeping from the 2026-08-05 audit.

Independent, dry-run-first STEPS. Each reports what it would do and writes
nothing unless you pass --apply. Reads via the Sheets API (accurate, no
truncation); numeric cells round-trip via UNFORMATTED_VALUE.

    python backend/scripts/cleanup_sheet.py --step <name>            # dry-run
    python backend/scripts/cleanup_sheet.py --step <name> --apply    # do it

Steps:
  tabs         Delete the junk env-var-named staging tabs + empty stray tabs.
  blankrows    Delete fully-empty rows (partial-write residue) in the high-traffic
               tabs. Run the app's Sync & Accuracy audit FIRST and confirm zero
               missing - the reconciler re-drove the real data, these are leftovers.
  dedupe       Remove duplicate JobReports (keep latest updated_at; their dupes
               differ only in metadata). Events duplicates are REPORT ONLY - they
               are timestamp edits with no safe automated keep rule; the step
               prints each pair with a keep/delete recommendation for a human.
  officehours  Trim OfficeHours' 15 phantom trailing columns (K..Z).
  protect      Add a warning-only protected range on row 1 of EVERY tab, so an
               accidental header edit is caught (prevents the whole audit finding #1).
  all          Dry-run report of every step (no --apply for 'all'; run steps
               individually to apply).

Env (same as the app): DATABASE_URL (to read the Google token) and
GOOGLE_SHEETS_SPREADSHEET_ID (required, no default - this touches prod).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.integrations.sheets_export import _api, _get_sheets_svc, _sheet_ids

# Exact junk tabs (env-var-name-as-tab-name) + known-empty strays to delete.
JUNK_TABS = [
    "sheetsIncidentsTabStaging",
    "sheetsJobInventoryTabStaging",
    "sheetsJobInventoryItemsTabStaging",
    "sheetsOffJobTabStaging",
]
EMPTY_STRAYS = ["OffJobHours"]  # empty duplicate beside the live `offJob`; only if truly empty

# Fully-blank residue rows to sweep (key column is column A on all of these).
BLANKROW_TABS = ["Events", "EventsStaging", "Bills", "DVIRs", "DVIRsStaging"]

# (tab, key, tiebreak) - keep the row with the max tiebreak per key. JobReports
# duplicates differ only in metadata (updated_at / submitted_by), so keeping the
# latest is safe. Events are NOT auto-deduped: their duplicates are timestamp
# EDITS where the authoritative row is the admin's manual correction, and no
# column reliably identifies it (a "latest logged_at" rule would keep the wrong,
# device-time row and revert the correction). They are reported for a human call.
DEDUPE = [("JobReports", "job_uuid", "updated_at")]

OFFICEHOURS_KEEP_COLS = 11  # the 11 real columns; drop everything past them


def _svc_and_id():
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        sys.exit("error: DATABASE_URL is required (to read the Google OAuth token)")
    sid = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not sid:
        sys.exit("error: GOOGLE_SHEETS_SPREADSHEET_ID is required (the real workbook id)")
    db = sessionmaker(bind=create_engine(db_url))()
    try:
        return _get_sheets_svc(db), sid
    finally:
        db.close()


def _meta(svc, sid):
    """{name: {'sheetId':.., 'rows':.., 'cols':.., 'hidden':bool}}."""
    m = _api(lambda: svc.spreadsheets().get(
        spreadsheetId=sid,
        fields="sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))",
    ).execute())
    out = {}
    for s in m.get("sheets", []):
        p = s["properties"]
        out[p["title"]] = {
            "sheetId": p["sheetId"],
            "rows": p["gridProperties"]["rowCount"],
            "cols": p["gridProperties"]["columnCount"],
            "hidden": bool(p.get("hidden")),
        }
    return out


def _values(svc, sid, tab):
    return _api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=sid, range=tab, valueRenderOption="UNFORMATTED_VALUE",
    ).execute()).get("values", [])


def _delete_rows(svc, sid, sheet_id, zero_based_indices):
    """Delete the given 0-based grid rows (bottom-up so indices don't shift)."""
    reqs = [{"deleteDimension": {"range": {
        "sheetId": sheet_id, "dimension": "ROWS", "startIndex": i, "endIndex": i + 1,
    }}} for i in sorted(zero_based_indices, reverse=True)]
    if reqs:
        _api(lambda: svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute())


# ── steps ─────────────────────────────────────────────────────────────────────
def step_tabs(svc, sid, apply):
    meta = _meta(svc, sid)
    to_delete = []
    for name, info in meta.items():
        junk = name in JUNK_TABS or name.startswith("sheets") and name.endswith("Staging")
        empty_stray = name in EMPTY_STRAYS
        if junk:
            to_delete.append((name, info, "junk env-var tab"))
        elif empty_stray:
            # only if truly empty (no data rows)
            vals = _values(svc, sid, name)
            if len([r for r in vals[1:] if any(str(c).strip() for c in r)]) == 0:
                to_delete.append((name, info, "empty stray tab"))
            else:
                print(f"  SKIP {name}: not empty ({len(vals)-1} rows) - not deleting")
    for name, info, why in to_delete:
        print(f"  delete tab {name!r}  ({why}, {info['hidden'] and 'hidden' or 'visible'})")
    if apply:
        reqs = [{"deleteSheet": {"sheetId": meta[n]["sheetId"]}} for n, _, _ in to_delete]
        if reqs:
            _api(lambda: svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute())
            print(f"  deleted {len(reqs)} tab(s).")
    else:
        print(f"  DRY RUN: would delete {len(to_delete)} tab(s).")


def step_blankrows(svc, sid, apply):
    meta = _meta(svc, sid)
    for tab in BLANKROW_TABS:
        if tab not in meta:
            print(f"  {tab}: not found, skip"); continue
        vals = _values(svc, sid, tab)
        # grid index i (0-based); i==0 is the header. A row is blank when EVERY
        # cell in it is empty. values() trims trailing empties, so these are the
        # interspersed residue rows only.
        blanks = [i for i in range(1, len(vals)) if not any(str(c).strip() for c in vals[i])]
        print(f"  {tab}: {len(blanks)} fully-blank residue row(s){' -> ' + str([b+1 for b in blanks]) if blanks else ''}")
        if apply and blanks:
            _delete_rows(svc, sid, meta[tab]["sheetId"], blanks)
            print(f"    deleted {len(blanks)} row(s).")


def step_dedupe(svc, sid, apply):
    import collections
    meta = _meta(svc, sid)
    for tab, key, tie in DEDUPE:
        if tab not in meta:
            print(f"  {tab}: not found, skip"); continue
        vals = _values(svc, sid, tab)
        header = vals[0]
        ki = header.index(key)
        ti = header.index(tie) if tie in header else -1
        groups = collections.defaultdict(list)  # key -> [(grid_index, row)]
        for i in range(1, len(vals)):
            k = str(vals[i][ki]).strip() if ki < len(vals[i]) else ""
            if k:
                groups[k].append((i, vals[i]))
        drop = []
        for k, rows in groups.items():
            if len(rows) < 2:
                continue
            # keep the row with the max tiebreak (string compare on ISO ts)
            keep = max(rows, key=lambda ir: str(ir[1][ti]) if 0 <= ti < len(ir[1]) else "")
            for i, row in rows:
                if i != keep[0]:
                    drop.append(i)
                    tv = str(row[ti]) if 0 <= ti < len(row) else ""
                    kv = str(keep[1][ti]) if 0 <= ti < len(keep[1]) else ""
                    print(f"  {tab} {k[:16]}: drop row {i+1} ({tie}={tv})  keep row {keep[0]+1} ({tie}={kv})")
        print(f"  {tab}: {len(drop)} duplicate row(s) to remove.")
        if apply and drop:
            _delete_rows(svc, sid, meta[tab]["sheetId"], drop)
            print(f"    deleted {len(drop)} row(s).")

    # Events: REPORT ONLY. Duplicates are timestamp edits; the authoritative row
    # is the admin's manual correction (a clean, non-device time). No safe
    # automated rule, so print both rows and recommend - the human deletes the
    # device-time row by hand to keep the correction.
    if "Events" in meta:
        vals = _values(svc, sid, "Events")
        h = vals[0]
        ei, ii, li = h.index("event_id"), h.index("timestamp"), (h.index("logged_at") if "logged_at" in h else -1)
        grp = collections.defaultdict(list)
        for i in range(1, len(vals)):
            k = str(vals[i][ei]).strip() if ei < len(vals[i]) else ""
            if k:
                grp[k].append((i, vals[i]))
        dupes = {k: r for k, r in grp.items() if len(r) > 1}
        if dupes:
            print(f"\n  Events: {len(dupes)} duplicated event_id(s) - REPORT ONLY (resolve by hand):")
            for k, rows in dupes.items():
                print(f"    {k}")
                for i, row in rows:
                    ts = str(row[ii]) if ii < len(row) else ""
                    lg = str(row[li]) if 0 <= li < len(row) else ""
                    dev = "device-time" if ts and lg and ts.rstrip("Z0").rstrip(".") == lg.rstrip("Z0").rstrip(".") else "MANUAL edit (keep)"
                    print(f"      row {i+1}: timestamp={ts:30} logged_at={lg:30} -> {dev}")
            print("    -> keep the MANUAL-edit row; delete the device-time row(s) by hand.")


def step_officehours(svc, sid, apply):
    tab = "OfficeHours"
    meta = _meta(svc, sid)
    if tab not in meta:
        print(f"  {tab}: not found"); return
    vals = _values(svc, sid, tab)
    header = vals[0]
    used = len(header)
    # Confirm columns past the real 11 are empty across all rows before dropping.
    extra = range(OFFICEHOURS_KEEP_COLS, max(used, meta[tab]["cols"]))
    nonempty = [c for c in extra if any((c < len(r) and str(r[c]).strip()) for r in vals)]
    print(f"  {tab}: {used} header cols; columns past {OFFICEHOURS_KEEP_COLS} with any data: {nonempty or 'none'}")
    if nonempty:
        print("    REFUSING: some phantom columns hold data - inspect before trimming.")
        return
    grid_cols = meta[tab]["cols"]
    if grid_cols <= OFFICEHOURS_KEEP_COLS:
        print("    nothing to trim."); return
    print(f"    would drop columns {OFFICEHOURS_KEEP_COLS+1}..{grid_cols}")
    if apply:
        _api(lambda: svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
            {"deleteDimension": {"range": {"sheetId": meta[tab]["sheetId"], "dimension": "COLUMNS",
             "startIndex": OFFICEHOURS_KEEP_COLS, "endIndex": grid_cols}}}
        ]}).execute())
        print(f"    trimmed to {OFFICEHOURS_KEEP_COLS} columns.")


def step_protect(svc, sid, apply):
    meta = _meta(svc, sid)
    # Existing protected ranges, to avoid duplicates on re-run.
    existing = _api(lambda: svc.spreadsheets().get(
        spreadsheetId=sid, fields="sheets(properties(sheetId,title),protectedRanges(range(sheetId,startRowIndex,endRowIndex)))",
    ).execute())
    have = set()
    for s in existing.get("sheets", []):
        for pr in s.get("protectedRanges", []):
            r = pr.get("range", {})
            if r.get("startRowIndex", -1) == 0 and r.get("endRowIndex", -1) == 1:
                have.add(r.get("sheetId"))
    reqs = []
    for name, info in meta.items():
        if info["sheetId"] in have:
            continue
        reqs.append({"addProtectedRange": {"protectedRange": {
            "range": {"sheetId": info["sheetId"], "startRowIndex": 0, "endRowIndex": 1},
            "description": "Header row - do not overwrite (audit 2026-08-05)",
            "warningOnly": True,
        }}})
    print(f"  {len(have)} tab(s) already protect row 1; {len(reqs)} to add.")
    if apply and reqs:
        _api(lambda: svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute())
        print(f"  protected row 1 on {len(reqs)} tab(s) (warning-only).")


STEPS = {
    "tabs": step_tabs, "blankrows": step_blankrows, "dedupe": step_dedupe,
    "officehours": step_officehours, "protect": step_protect,
}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--step", required=True, choices=list(STEPS) + ["all"])
    ap.add_argument("--apply", action="store_true", help="Write changes. Omit for a dry run.")
    args = ap.parse_args()
    svc, sid = _svc_and_id()

    if args.step == "all":
        if args.apply:
            sys.exit("error: run steps individually to --apply; 'all' is dry-run only.")
        for name, fn in STEPS.items():
            print(f"\n===== {name} =====")
            fn(svc, sid, False)
        return
    STEPS[args.step](svc, sid, args.apply)
    if not args.apply:
        print("\nDRY RUN - nothing written. Add --apply to do it.")


if __name__ == "__main__":
    main()
