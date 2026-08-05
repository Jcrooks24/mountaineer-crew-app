"""Read-only: how much money the Reimbursements duplication ACTUALLY cost.

The 2026-08-05 audit found the tab held duplicate rows - a ~$17,088 over-COUNT.
That is only paperwork unless a duplicate copy was actually PAID. Payments are
marked by hand with a GREEN cell fill. This script reads the pre-repair backup
tab WITH its formatting, groups rows by reimbursement, and flags any
reimbursement whose duplicate copies were BOTH filled green - those are the real
double-payments. It sums the dollar damage and names who was double-paid. It
writes NOTHING.

Why the backup tab: the repair cleared + rewrote the live Reimbursements tab, and
a values rewrite drops cell formatting, so the green "paid" fills only survive on
the duplicated backup tab.

    DATABASE_URL=<prod-postgres> GOOGLE_SHEETS_SPREADSHEET_ID=<id> \\
      python backend/scripts/audit_reimbursement_payments.py

    # options
    #   --tab NAME     which tab to read (default Reimbursements_backup_preRepair)
    #   --palette      just dump every distinct fill colour it sees + counts, then exit
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.integrations.sheets_export import _api, _get_sheets_svc


def _f(v) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _bg(cell: dict) -> dict | None:
    """The cell's effective background colour as {red,green,blue} (0..1), or None
    for no fill. Handles both the legacy backgroundColor and backgroundColorStyle."""
    fmt = (cell or {}).get("effectiveFormat", {})
    c = fmt.get("backgroundColor")
    if not c:
        c = fmt.get("backgroundColorStyle", {}).get("rgbColor")
    return c


def _rgb(c: dict | None) -> tuple[float, float, float]:
    c = c or {}
    return (c.get("red", 0.0), c.get("green", 0.0), c.get("blue", 0.0))


def is_green(c: dict | None) -> bool:
    """A manual green 'paid' fill: clearly green-dominant, not white/no-fill/grey.
    Google's greens ('light green 3' = ~0.85/0.92/0.83 up to full 0/1/0) all satisfy
    green being the top channel by a margin. White (1,1,1) and greys (r==g==b) fail."""
    r, g, b = _rgb(c)
    if r > 0.93 and g > 0.93 and b > 0.93:  # white / near-white = no fill
        return False
    return g >= 0.55 and (g - r) >= 0.05 and (g - b) >= 0.05


def _key(v) -> str:
    return str(v).strip() if v is not None else ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tab", default="Reimbursements_backup_preRepair")
    ap.add_argument("--palette", action="store_true", help="Dump distinct fill colours + counts, then exit.")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        sys.exit("error: DATABASE_URL is required (to read the Google OAuth token)")
    sid = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not sid:
        sys.exit("error: GOOGLE_SHEETS_SPREADSHEET_ID is required (the real workbook id)")

    db = sessionmaker(bind=create_engine(db_url))()
    try:
        svc = _get_sheets_svc(db)
    finally:
        db.close()

    # Pull the tab WITH per-cell fill + value. effectiveValue gives the real number
    # for amounts; formattedValue is the display text for names/uuids/dates.
    resp = _api(lambda: svc.spreadsheets().get(
        spreadsheetId=sid, ranges=[args.tab], includeGridData=True,
        fields="sheets(properties(title),data(rowData(values("
               "effectiveFormat(backgroundColor,backgroundColorStyle/rgbColor),"
               "effectiveValue,formattedValue))))",
    ).execute())
    sheets = resp.get("sheets", [])
    if not sheets:
        sys.exit(f"error: tab {args.tab!r} not found in the workbook")
    data = sheets[0].get("data", [{}])[0]
    row_data = data.get("rowData", [])
    if not row_data:
        sys.exit(f"error: tab {args.tab!r} is empty")

    def cells(r):
        return (row_data[r].get("values", []) if r < len(row_data) else [])

    def text(r, c):
        vals = cells(r)
        if c < 0 or c >= len(vals):
            return ""
        cell = vals[c]
        if "formattedValue" in cell:
            return str(cell["formattedValue"]).strip()
        ev = cell.get("effectiveValue", {})
        return _key(ev.get("stringValue", ev.get("numberValue", "")))

    def number(r, c):
        vals = cells(r)
        if c < 0 or c >= len(vals):
            return 0.0
        ev = vals[c].get("effectiveValue", {})
        if "numberValue" in ev:
            return float(ev["numberValue"])
        return _f(text(r, c))

    # ── colour palette (always compute; --palette just prints it and stops) ──────
    palette: dict[tuple, dict] = {}
    for r in range(len(row_data)):
        for cell in cells(r):
            c = _bg(cell)
            k = tuple(round(x, 3) for x in _rgb(c)) if c else None
            slot = palette.setdefault(k, {"count": 0, "green": is_green(c)})
            slot["count"] += 1
    if args.palette:
        print(f"Distinct fill colours in {args.tab!r} (None = no fill):")
        for k, info in sorted(palette.items(), key=lambda kv: -kv[1]["count"]):
            tag = "  <- classified GREEN (paid)" if info["green"] else ""
            print(f"  {str(k):28} x{info['count']:<6}{tag}")
        return

    # ── resolve columns from the (corrupted) header row ─────────────────────────
    header = [text(0, c) for c in range(len(cells(0)))]

    def find(name, default=-1):
        return header.index(name) if name in header else default

    COL_UUID = 0  # legacy rows carry reimbursement_uuid in physical column A
    dup_uuid = next((i for i, h in enumerate(header) if h == "reimbursement_uuid" and i != COL_UUID), -1)
    col_name = find("user_name", 1)
    col_amount = find("amount")
    col_type = find("type")
    col_submitted = find("submitted_at", 2)
    if col_amount < 0:
        sys.exit(f"error: no 'amount' column in header {header!r} - cannot size the damage")

    def uuid_of(r):
        return text(r, COL_UUID) or (text(r, dup_uuid) if dup_uuid >= 0 else "")

    def row_green(r):
        """(is any cell green, [column indexes that were green])."""
        greens = [c for c, cell in enumerate(cells(r)) if is_green(_bg(cell))]
        return (bool(greens), greens)

    # ── group by reimbursement, look for duplicates paid more than once ─────────
    groups: dict[str, list[int]] = {}
    for r in range(1, len(row_data)):
        u = uuid_of(r)
        if u:
            groups.setdefault(u, []).append(r)

    total_rows = sum(len(v) for v in groups.values())
    dup_groups = {u: rs for u, rs in groups.items() if len(rs) > 1}

    paid_rows = 0            # rows marked green
    paid_amount = 0.0        # sum of green rows' amounts (what was actually disbursed)
    double_pays = []         # reimbursements where >1 copy was green
    green_cols_seen = set()

    for u, rs in groups.items():
        green_rs = []
        for r in rs:
            g, cols = row_green(r)
            if g:
                paid_rows += 1
                paid_amount += number(r, col_amount)
                green_rs.append(r)
                green_cols_seen.update(cols)
        if len(green_rs) >= 2:
            amt = number(green_rs[0], col_amount)
            double_pays.append({
                "uuid": u,
                "name": text(green_rs[0], col_name),
                "type": text(green_rs[0], col_type) if col_type >= 0 else "",
                "amount": amt,
                "green_count": len(green_rs),
                "overpaid": sum(number(r, col_amount) for r in green_rs) - amt,
                "rows": [r + 1 for r in green_rs],
            })

    print(f"Tab:                         {args.tab}")
    print(f"Header (raw, corrupted ok):  {header}")
    print(f"Columns -> uuid A/{dup_uuid}, name {col_name}, amount {col_amount}, type {col_type}")
    print(f"Green fill found in cols:    {sorted(green_cols_seen) or 'none'}  "
          f"(header names: {[header[c] if c < len(header) else '?' for c in sorted(green_cols_seen)]})")
    print()
    print(f"Distinct reimbursements:     {len(groups)}")
    print(f"Total data rows:             {total_rows}")
    print(f"Reimbursements duplicated:   {len(dup_groups)}")
    print(f"Rows marked PAID (green):    {paid_rows}")
    print(f"Total disbursed (green sum): ${paid_amount:,.2f}")
    print()
    if not double_pays:
        print("RESULT: no reimbursement had more than one GREEN (paid) copy.")
        print("        The duplication inflated the COUNT but caused $0.00 in actual double-payment.")
    else:
        dmg = sum(d["overpaid"] for d in double_pays)
        print(f"RESULT: {len(double_pays)} reimbursement(s) were paid on MORE than one copy.")
        print(f"        ACTUAL double-payment damage: ${dmg:,.2f}")
        print()
        print(f"  {'who':22} {'type':16} {'amount':>10} {'x paid':>7}  rows")
        for d in sorted(double_pays, key=lambda d: -d["overpaid"]):
            print(f"  {d['name'][:22]:22} {d['type'][:16]:16} ${d['amount']:>8,.2f} "
                  f"{d['green_count']:>6}x  {d['rows']}")
    print("\n(read-only - nothing was written)")


if __name__ == "__main__":
    main()
