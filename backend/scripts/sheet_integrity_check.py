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
    #   --no-completeness  structural checks only (skip the server->sheet audit)
    #   --no-mem           suppress the [mem] RSS checkpoints

Exit code: 0 when there are no FAILs, 1 when any FAIL is present.

**Memory checkpoints.** This job has a history of being OOM-killed on the 512 MB
Render worker, and a SIGKILL leaves no traceback - only exit code 137. So it
prints `[mem]` checkpoints (current RSS, step delta, peak) to stdout as it goes,
unbuffered, before each tab and around each pass. When it dies, the last `[mem]`
line in the Render log names what it was doing. See `app/core/memprobe.py`.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import memprobe
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


# ── Why this pass is batched, and why it must stay batched ───────────────────
#
# Two OOM fixes have been made here. The first replaced whole-tab reads
# (`range=tab`, every cell of every column including the long free-text ones)
# with a header row plus one key column. That was real and necessary, and it was
# NOT sufficient - the job still died. The second fix is this one, and it came
# from a measurement rather than a third reading of the code.
#
# The 2026-08-12 log, with the [mem] checkpoints below, showed RSS climbing
# ~18.7 MB per Sheets API call and never falling:
#
#     about to read Materials   step=+58Mi   (Events: 3 calls)
#     about to read JobReports  step=+38Mi   (Materials: 2 calls)
#     about to read Bills       step=+56Mi   (JobReports: 3 calls)
#     about to read DVIRs       step=+37Mi   (Bills: 2 calls)
#     about to read Estimates   step=+0Mi    (LongDistancePay: tab absent, 0 calls)
#
# Two and three-call tabs cost 37 and 56 MB regardless of how much data they
# hold: tiny PriorOnDuty cost the same per call as JobReports, and the tab that
# does not exist cost exactly nothing. **The cost tracks the number of API
# calls, not the volume of data.** So the fix is to make far fewer calls, which
# is correct whatever is retaining the per-call allocations.
#
# `spreadsheets().values().batchGet` takes many ranges in one request. That
# takes the structural pass from ~50 calls to ~5. Note also that for every
# keyed tab in REGISTRY the unique key IS the first expected header, so the
# duplicate check and the residue check were reading the same column twice, in
# two separate calls.
#
# `audit_sheet_backfill` has been batched like this from the start - its
# docstring promises "three Sheets calls for the whole audit regardless of how
# many syncs are registered". This pass was the naive half.
#
# Do not "simplify" this back into a per-tab loop of single `values().get()`
# calls, and do not reintroduce a whole-tab fetch.

# Ranges per batchGet request. Bounds the size of any single response so the
# saving in call count is not traded for one enormous parse: the failure being
# fixed was per-call overhead, and collapsing 50 calls to 1 would fix that while
# creating a new peak. Five-ish requests is well past the point of diminishing
# returns on the per-call cost.
_BATCH_RANGES = 8


def _batch_get(svc, sid, ranges: list, major: str) -> dict:
    """Read many ranges in as few API calls as possible.

    Returns {requested range string: values}. Results are keyed by the range
    string as sent, and matched to the response positionally, so the caller does
    not depend on Google echoing the range back in the same form it was given.
    """
    out: dict = {}
    for start in range(0, len(ranges), _BATCH_RANGES):
        chunk = ranges[start:start + _BATCH_RANGES]
        # chunk bound as a default arg: the lambda is called by _api after the
        # loop variable would otherwise have moved on.
        resp = se._api(lambda c=chunk: svc.spreadsheets().values().batchGet(
            spreadsheetId=sid, ranges=c, majorDimension=major,
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute())
        for requested, value_range in zip(chunk, resp.get("valueRanges", [])):
            out[requested] = value_range.get("values", []) or []
    return out


def _quote_tab(tab: str) -> str:
    """A1 range prefix for a tab. Single-quoted, with internal quotes doubled,
    so a tab named `Bob's Jobs` does not produce a malformed range."""
    return "'" + tab.replace("'", "''") + "'"


def _column_from(values: list) -> list:
    """Data rows of a COLUMNS-major single-column read, header cell dropped."""
    col = values[0] if values else []
    return col[1:]


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
    ap.add_argument("--no-mem", action="store_true",
                    help="Suppress the [mem] RSS checkpoints (on by default; see below).")
    args = ap.parse_args()

    # Memory checkpoints are ON by default for this job, not behind a flag you have
    # to remember to pass. This job is OOM-killed on the 512 MB worker, and a
    # SIGKILL leaves no traceback - the last [mem] line to reach the Render log
    # before the kill is the only evidence of where the memory went. A handful of
    # extra log lines a night is a cheap price for that.
    if not args.no_mem:
        memprobe.enable()
    memprobe.probe("start (imports loaded)")

    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        sys.exit("error: DATABASE_URL is required (to read the Google OAuth token)")
    sid = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not sid:
        sys.exit("error: GOOGLE_SHEETS_SPREADSHEET_ID is required (the real workbook id)")

    db = sessionmaker(bind=create_engine(db_url))()
    svc = se._get_sheets_svc(db)  # keep the session open for the completeness audit below

    memprobe.probe("sheets service + db session open")

    all_tabs = se._sheet_ids(svc, sid, refresh=True)  # {name: sheetId}
    memprobe.probe(f"workbook metadata read ({len(all_tabs)} tabs)")
    fails: list[str] = []
    warns: list[str] = []

    # STRUCTURAL: is the sheet internally consistent? ----------------------------
    # 1) junk env-var-named tabs anywhere in the workbook
    for name in all_tabs:
        low = name.lower()
        if low.startswith("sheets") and name.endswith("Staging"):
            fails.append(f"junk tab present: {name!r} (env-var-named; should not exist)")

    # 2) per registered tab, in three phases: read all headers, read all key
    #    columns, then judge. An absent tab costs no API call at all, which is
    #    why LongDistancePay showed a step of exactly +0Mi in the log above.
    scan = []  # [(tab, expected headers, unique key or None)]
    for env_var, default, headers_attr, ukey in REGISTRY:
        tab = _tab_name(env_var, default)
        if tab not in all_tabs:
            continue  # tab is created on first write; absence is not a defect
        scan.append((tab, getattr(se, headers_attr), ukey))

    # 2a) every header row, batched.
    header_ranges = [f"{_quote_tab(tab)}!1:1" for tab, _, _ in scan]
    header_vals = _batch_get(svc, sid, header_ranges, "ROWS")
    headers = {}
    for (tab, _, _), rng in zip(scan, header_ranges):
        rows = header_vals.get(rng) or []
        headers[tab] = [str(h).strip() for h in (rows[0] if rows else [])]
    del header_vals
    memprobe.probe(f"structural: {len(scan)} header rows read")

    # 2b) the key column of every tab that has a usable header, batched. Built
    #     as a set of column INDEXES per tab: the duplicate check and the residue
    #     check want the same column on every tab in REGISTRY today, so this is
    #     one range per tab, but it stays correct if a future entry keys its
    #     duplicate check on some other column.
    col_range_of = {}  # (tab, column index) -> range string
    for tab, expected, ukey in scan:
        header = headers[tab]
        if not header or expected[0] not in header:
            continue  # reported below; do not spend a read on it
        want = {header.index(expected[0])}
        if ukey and ukey in header:
            want.add(header.index(ukey))
        for idx in sorted(want):
            letter = se._col_letter(idx)
            col_range_of[(tab, idx)] = f"{_quote_tab(tab)}!{letter}:{letter}"
    col_vals = _batch_get(svc, sid, list(col_range_of.values()), "COLUMNS")
    memprobe.probe(f"structural: {len(col_range_of)} key columns read")

    def _key_column(tab: str, index: int) -> list:
        return _column_from(col_vals.get(col_range_of.get((tab, index), ""), []))

    # 2c) judge. No API calls past this point.
    for tab, expected, ukey in scan:
        header = headers[tab]
        if not header:
            warns.append(f"{tab}: exists but has no header row")
            continue

        # KEY column present (the corruption check - mirrors _ensure_tab guard)
        key0 = expected[0]
        if key0 not in header:
            fails.append(f"{tab}: KEY column {key0!r} missing from header {header} "
                         f"(row 1 renamed/overwritten?)")
            continue  # everything downstream keys off this; don't cascade noise

        # all other expected columns present (usually un-promoted work -> warn)
        missing = [h for h in expected if h not in header]
        if missing:
            warns.append(f"{tab}: expected column(s) absent: {missing}")

        # duplicate rows for a one-per-key tab
        if ukey and ukey in header:
            # Count straight into the Counter rather than materializing a list of
            # every key first: same result, one copy of the data instead of two.
            counts = Counter(
                s for s in (str(v).strip() for v in _key_column(tab, header.index(ukey)))
                if s
            )
            dups = {k: c for k, c in counts.items() if c > 1}
            if dups:
                shown = dict(list(dups.items())[:5])
                fails.append(f"{tab}: {len(dups)} duplicated {ukey}(s) "
                             f"({sum(dups.values())} rows) e.g. {shown}")

        # residue rows: a data row whose KEY cell is empty.
        #
        # This used to test whether an ENTIRE row was blank, which needed every
        # cell of the tab in memory - the read that caused the first OOM. The key
        # column answers the same question within the memory budget, and answers
        # a slightly better one: a row with no key is a defect whether or not the
        # rest of it is empty, because every lookup, dedupe and replace-style
        # delete on this tab is keyed off that column. A blank-key row is either
        # residue or a row that has lost its identity, and both want reporting.
        key_col = _key_column(tab, header.index(key0))
        # +2: the list is data rows only (header dropped), and sheet rows are
        # 1-based, so element 0 is sheet row 2.
        blanks = [i + 2 for i, v in enumerate(key_col) if not str(v).strip()]
        if blanks:
            warns.append(f"{tab}: {len(blanks)} row(s) with an empty {key0!r} at "
                         f"{blanks[:10]}" + (" ..." if len(blanks) > 10 else ""))

    # Release the key-column data before the completeness pass, which does its
    # own large reads. `.clear()` and not `del`: `_key_column` closes over this
    # dict, so rebinding the name would leave the closure cell holding every
    # column alive and free nothing. Mutating the object frees the data for real.
    col_vals.clear()

    # COMPLETENESS: does the sheet mirror every current server record? -----------
    # The Sheet is the long-term record; the server data is treated as transient.
    # A record on the server but not in the sheet is the thing to catch here.
    memprobe.probe("structural pass complete")
    if not args.no_completeness:
        _completeness_checks(db, fails, warns)
        memprobe.probe("completeness pass complete")
    db.close()
    memprobe.probe("db session closed")

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
