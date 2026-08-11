"""Nightly Google Sheet integrity check - the canary that keeps the mirror clean.

Re-derives, from the app's OWN header constants, what each tab should look like and
asserts it against the live sheet. Catches the whole class of drift behind the
2026-08-05 audit BEFORE it compounds:

  FAIL (emails an alert):
    - a tab's KEY column (its uuid/id, the first expected header) is missing from
      the live header row  -> a `dfg`-style header overwrite
    - duplicate rows for a one-per-key tab                       -> the dedupe broke
    - a junk env-var-named tab (sheets*Staging etc.)            -> a misconfig
    - a server record NOT present in the sheet (server->sheet completeness) -> a
      broken/stuck sync; that record could be lost if the DB ages out before it
      reaches the sheet. This is the point of the nightly run: the Sheet is the
      long-term record, so prove every current server record is in it.
  WARN (reported, emailed only with --email-warnings or alongside a FAIL):
    - expected columns absent (often just un-promoted staging work)
    - fully-blank residue rows between data rows

The completeness pass reuses the app's OWN reconciler (audit_sheet_backfill for the
diffable syncs; the Events/BOL marker-table counters for the two auto-reconciled
ones), so it stays correct as syncs are added. Pass --no-completeness for a
structural-only run.

Reuses the code's *_HEADERS constants, so when future dev adds a column the check
follows automatically - no second source of truth to keep in sync.

    DATABASE_URL=<prod-postgres> GOOGLE_SHEETS_SPREADSHEET_ID=<id> \\
      POSTMARK_SERVER_TOKEN=<tok> SMTP_FROM=<from> \\
      python backend/scripts/sheet_integrity_check.py

    # options
    #   --email-warnings   email even when there are only warnings (no failures)
    #   --force-email      send the report no matter what (use to test wiring)
    #   --no-email         never email; just print + exit code

Exit code: 0 when there are no FAILs, 1 when any FAIL is present.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.mailer import send_email
from app.integrations import sheets_export as se

ALERT_EMAIL = os.getenv("ALERT_EMAIL", "jacob@mountaineermoving.com").strip()

# (env var, default/prod tab name, *_HEADERS attr on sheets_export, unique key or None)
# unique key is set ONLY for tabs that hold exactly one row per key (replace-style
# summaries). *Items and append-style tabs legitimately repeat a key, so they get
# no duplicate check (unique key None).
REGISTRY = [
    ("SHEETS_EVENTS_TAB",            "Events",            "EVENTS_HEADERS",           "event_id"),
    ("SHEETS_MATERIALS_TAB",         "Materials",         "MATERIALS_HEADERS",        None),
    ("SHEETS_JOB_REPORTS_TAB",       "JobReports",        "JOB_REPORT_HEADERS",       "job_uuid"),
    ("SHEETS_BILLS_TAB",             "Bills",             "BILL_HEADERS",             None),
    ("SHEETS_DVIRS_TAB",             "DVIRs",             "DVIR_HEADERS",             None),
    ("SHEETS_PRIOR_HOURS_TAB",       "PriorOnDuty",       "PRIOR_HOURS_HEADERS",      None),
    ("SHEETS_RODS_TAB",              "RODS",              "RODS_HEADERS",             "rods_id"),
    ("SHEETS_LD_PAY_TAB",            "LongDistancePay",   "LD_DAY_HEADERS",           "day_id"),
    ("SHEETS_ESTIMATES_TAB",         "Estimates",         "ESTIMATE_HEADERS",         None),
    ("SHEETS_ESTIMATE_ITEMS_TAB",    "EstimateItems",     "ESTIMATE_ITEM_HEADERS",    None),
    ("SHEETS_BOLS_TAB",              "BOLs",              "BOL_HEADERS",              None),
    ("SHEETS_BOL_ITEMS_TAB",         "BOLItems",          "BOL_ITEM_HEADERS",         None),
    ("SHEETS_JOB_INVENTORY_TAB",     "JobInventory",      "JOB_INVENTORY_HEADERS",    None),
    ("SHEETS_JOB_INVENTORY_ITEMS_TAB", "JobInventoryItems", "JOB_INVENTORY_ITEM_HEADERS", None),
    ("SHEETS_INCIDENTS_TAB",         "Incidents",         "INCIDENT_HEADERS",         "incident_uuid"),
    ("SHEETS_BUGS_TAB",              "Bugs",              "BUG_REPORT_HEADERS",       "bug_uuid"),
    ("SHEETS_FEATURE_REQUESTS_TAB",  "FeatureRequests",   "FEATURE_REQUEST_HEADERS",  "request_uuid"),
    ("SHEETS_OFFICE_HOURS_TAB",      "OfficeHours",       "OFFICE_HOURS_HEADERS",     "entry_uuid"),
    ("SHEETS_REIMBURSEMENTS_TAB",    "Reimbursements",    "REIMBURSEMENT_HEADERS",    "reimbursement_uuid"),
    ("SHEETS_AVAILABILITY_TAB",      "Availability",      "AVAILABILITY_HEADERS",     None),
    ("SHEETS_OFF_JOB_TAB",           "OffJobHours",       "OFF_JOB_HEADERS",          "entry_uuid"),
]


def _tab_name(env_var: str, default: str) -> str:
    return os.getenv(env_var, default).strip() or default


def _values(svc, sid, tab):
    return se._api(lambda: svc.spreadsheets().values().get(
        spreadsheetId=sid, range=tab, valueRenderOption="UNFORMATTED_VALUE",
    ).execute()).get("values", [])


def _completeness_checks(db, fails: list, warns: list) -> None:
    """Server -> sheet completeness: every CURRENT Postgres record must be present
    in the sheet. A record on the server but missing from the sheet is exactly what
    to catch before the transient server data ages out - the Sheet is the durable
    copy. Reuses the app's own reconciler so coverage tracks the real syncs."""
    from app.integrations.sheet_backfill import audit_sheet_backfill
    bf = audit_sheet_backfill(db)
    if not bf.get("connected"):
        fails.append(f"completeness: backfill audit could not run: {bf.get('error')}")
        return
    for r in bf.get("results", []):
        if r.get("auto"):
            continue  # Events/BOLs are counted separately below (not diffed here)
        if r.get("error"):
            warns.append(f"completeness: {r.get('label')} ({r.get('tab')}) "
                         f"not audited: {r['error']}")
            continue
        mc = r.get("missing_count") or 0
        if mc > 0:
            ids = ", ".join(str(m.get("id")) for m in (r.get("missing") or [])[:5])
            why = f"  [sync FAILING: {r.get('last_error')}]" if r.get("failing") else ""
            fails.append(
                f"completeness: {r.get('label')} ({r.get('tab')}) - {mc} server "
                f"record(s) MISSING from the sheet (db={r.get('in_db')}, "
                f"sheet={r.get('in_sheet')}) e.g. {ids}{why}")
    # Events + BOLs are auto-reconciled and only counted, not diffed, by the audit.
    try:
        from app.integrations.sheets_reconcile import count_unexported_events
        n = count_unexported_events(db)
        if n and n > 0:
            fails.append(f"completeness: Events - {n} server event(s) not yet in the sheet")
    except Exception as e:  # noqa: BLE001 - a counter hiccup must not kill the check
        warns.append(f"completeness: Events counter errored: {e}")
    try:
        from app.integrations.bol_reconcile import count_unexported_bols
        n = count_unexported_bols(db)
        if n and n > 0:
            fails.append(f"completeness: BOLs - {n} server BOL(s) not yet in the sheet")
    except Exception as e:  # noqa: BLE001
        warns.append(f"completeness: BOL counter errored: {e}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email-warnings", action="store_true")
    ap.add_argument("--force-email", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    ap.add_argument("--no-completeness", action="store_true",
                    help="Skip the server->sheet completeness audit (structural checks only).")
    args = ap.parse_args()

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        sys.exit("error: DATABASE_URL is required (to read the Google OAuth token)")
    sid = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not sid:
        sys.exit("error: GOOGLE_SHEETS_SPREADSHEET_ID is required (the real workbook id)")

    db = sessionmaker(bind=create_engine(db_url))()
    svc = se._get_sheets_svc(db)  # keep the session open for the completeness audit below

    all_tabs = se._sheet_ids(svc, sid, refresh=True)  # {name: sheetId}
    fails: list[str] = []
    warns: list[str] = []

    # STRUCTURAL: is the sheet internally consistent? ----------------------------
    # 1) junk env-var-named tabs anywhere in the workbook
    for name in all_tabs:
        low = name.lower()
        if low.startswith("sheets") and name.endswith("Staging"):
            fails.append(f"junk tab present: {name!r} (env-var-named; should not exist)")

    # 2) per registered tab
    for env_var, default, headers_attr, ukey in REGISTRY:
        tab = _tab_name(env_var, default)
        expected = getattr(se, headers_attr)
        if tab not in all_tabs:
            continue  # tab is created on first write; absence is not a defect
        vals = _values(svc, sid, tab)
        header = [str(h).strip() for h in (vals[0] if vals else [])]
        if not header:
            warns.append(f"{tab}: exists but has no header row")
            continue

        # 2a) KEY column present (the corruption check - mirrors _ensure_tab guard)
        key0 = expected[0]
        if key0 not in header:
            fails.append(f"{tab}: KEY column {key0!r} missing from header {header} "
                         f"(row 1 renamed/overwritten?)")
            continue  # everything downstream keys off this; don't cascade noise

        # 2b) all other expected columns present (usually un-promoted work -> warn)
        missing = [h for h in expected if h not in header]
        if missing:
            warns.append(f"{tab}: expected column(s) absent: {missing}")

        # 2c) duplicate rows for a one-per-key tab
        if ukey and ukey in header:
            ki = header.index(ukey)
            keys = [str(vals[i][ki]).strip() for i in range(1, len(vals))
                    if ki < len(vals[i]) and str(vals[i][ki]).strip()]
            dups = {k: c for k, c in Counter(keys).items() if c > 1}
            if dups:
                shown = dict(list(dups.items())[:5])
                fails.append(f"{tab}: {len(dups)} duplicated {ukey}(s) "
                             f"({sum(dups.values())} rows) e.g. {shown}")

        # 2d) fully-blank residue rows between data (values() trims trailing empties)
        blanks = [i + 1 for i in range(1, len(vals))
                  if not any(str(c).strip() for c in vals[i])]
        if blanks:
            warns.append(f"{tab}: {len(blanks)} fully-blank residue row(s) at {blanks[:10]}"
                         + (" ..." if len(blanks) > 10 else ""))

    # COMPLETENESS: does the sheet mirror every current server record? -----------
    # The Sheet is the long-term record; the server data is treated as transient.
    # A record on the server but not in the sheet is the thing to catch here.
    if not args.no_completeness:
        _completeness_checks(db, fails, warns)
    db.close()

    # ── report ──────────────────────────────────────────────────────────────────
    lines = [f"Sheet integrity check - {sid}", f"tabs scanned: {len(all_tabs)}",
             f"completeness: {'skipped' if args.no_completeness else 'checked'}", ""]
    lines.append(f"FAIL: {len(fails)}")
    lines += [f"  - {m}" for m in fails]
    lines.append(f"WARN: {len(warns)}")
    lines += [f"  - {m}" for m in warns]
    if not fails and not warns:
        lines.append("\nAll checks passed - the mirror is clean.")
    report = "\n".join(lines)
    print(report)

    should_email = args.force_email or (bool(fails) and not args.no_email) or \
        (args.email_warnings and bool(warns) and not args.no_email)
    if should_email:
        if not ALERT_EMAIL:
            print("\n(no ALERT_EMAIL set; skipping email)")
        else:
            status = "FAIL" if fails else ("WARN" if warns else "OK")
            send_email(
                to_email=ALERT_EMAIL,
                subject=f"[Crew App] Sheet integrity {status}: {len(fails)} fail / {len(warns)} warn",
                text=report,
            )
            print(f"\n(alert emailed to {ALERT_EMAIL})")

    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
