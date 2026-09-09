"""New Sheet columns land in the right place (vet findings 4 and 8, 2026-09-09).
`python scripts/test_sheet_new_columns.py`

WHY THIS EXISTS. Three facts the OFFICE owns were stored in Postgres and readable
nowhere the office looks: who granted a PTO entry, whether a reimbursement had
been paid, and whether it had been keyed into QuickBooks. Tips were worse - money
owed to a person, with no Sheet row at all. The Sheet is what the office
reconciles against, so "it is in the database" is not the same as recorded.

What is easy to get wrong and is therefore asserted here:

  1. A new column must APPEND to an existing tab, not rewrite its header. The
     Reimbursements header being overwritten is what produced 189 duplicate rows
     and a $17,088 over-count in the 2026-08-05 audit.
  2. `_build_row` maps POSITIONALLY against the header row that is actually in
     the sheet. A row built against the code's constant while the sheet has a
     different column order writes every value into the wrong column.
  3. Rows that predate the column must come back blank, not shifted.

Stubs the Sheets service entirely: no network, no credentials.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.integrations.sheets_export as sx  # noqa: E402

# Captured before any stub replaces it, so the header-guard check below can
# exercise the REAL _ensure_tab.
_REAL_ENSURE = sx._ensure_tab

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# A sheet that already exists with the OLD header row, so we exercise the
# append-a-column path rather than the create-a-tab path.
class FakeSheet:
    def __init__(self, header):
        self.header = list(header)
        self.written = []

    def install(self, tab):
        # Some exports append through the real client shape rather than
        # _write_rows_top, so the stub service has to answer
        # spreadsheets().values().append(...).execute().
        sheet = self

        class _Exec:
            def __init__(self, body):
                self.body = body

            def execute(self):
                sheet.written.extend(self.body.get("values", []))
                return {}

        class _Values:
            def append(self, **kw):
                return _Exec(kw.get("body") or {})

            def update(self, **kw):
                return _Exec(kw.get("body") or {})

        class _Spreadsheets:
            def values(self):
                return _Values()

        class _Svc:
            def spreadsheets(self):
                return _Spreadsheets()

        sx._get_sheets_svc = lambda db: _Svc()
        sx._ensure_tab = lambda svc, sid, t, headers: self._ensure(headers)
        sx._delete_sheet_rows_by_value = lambda *a, **k: 0
        sx._write_rows_top = lambda svc, sid, t, rows: self.written.extend(rows)

    def _ensure(self, wanted):
        # Mirrors the real _ensure_tab contract: existing columns keep their
        # position, missing ones are appended on the right.
        for col in wanted:
            if col not in self.header:
                self.header.append(col)
        return list(self.header)

    def row(self, i=0):
        return dict(zip(self.header, self.written[i]))


print("OffJobHours gains recorded_by, appended:")
OLD_OFF_JOB = ["entry_uuid", "submitted_by", "work_date", "start_time", "end_time",
               "hours", "pay_structure", "pay_other_note", "notes", "created_at"]
fs = FakeSheet(OLD_OFF_JOB)
fs.install("OffJobHours")
sx.export_off_job_to_sheets(None, {
    "entry_uuid": "e1", "submitted_by_name": "Casey", "work_date": "2026-09-08",
    "hours": 8, "pay_structure": "pto", "notes": "Paid time off",
    "created_at": "2026-09-08T12:00:00", "recorded_by_name": "Office",
})
check("the existing columns keep their order", fs.header[:len(OLD_OFF_JOB)] == OLD_OFF_JOB)
check("recorded_by is appended on the right", fs.header[-1] == "recorded_by")
check("and carries who in the office entered it", fs.row().get("recorded_by") == "Office",
      str(fs.row().get("recorded_by")))
check("the employee is still the submitter, not the recorder",
      fs.row().get("submitted_by") == "Casey")

print("\nA crew-logged entry leaves it blank rather than shifting the row:")
fs2 = FakeSheet(OLD_OFF_JOB)
fs2.install("OffJobHours")
sx.export_off_job_to_sheets(None, {
    "entry_uuid": "e2", "submitted_by_name": "Casey", "work_date": "2026-09-08",
    "hours": 3, "pay_structure": "regular", "notes": "", "created_at": "x",
})
check("recorded_by is empty", fs2.row().get("recorded_by") == "")
check("and every other column still lines up",
      fs2.row().get("hours") == 3 and fs2.row().get("pay_structure") == "regular",
      str(fs2.row()))

print("\nReimbursements gains the paid stamp and the QuickBooks columns:")
OLD_REIMB = ["reimbursement_uuid", "user_name", "submitted_at", "type", "job_name",
             "job_date", "expense_date", "odometer_start", "odometer_end", "miles",
             "odometer_start_photo_url", "odometer_end_photo_url", "amount",
             "category", "vendor", "payment_method", "receipt_photo_url",
             "photos_link", "notes", "status", "approver", "approved_at",
             "approval_notes", "created_at", "updated_at"]
fr = FakeSheet(OLD_REIMB)
fr.install("Reimbursements")
sx.export_reimbursement_to_sheets(None, {
    "reimbursement_uuid": "r1", "user_name": "Casey", "type": "expense",
    "amount": 25.0, "status": "approved", "expense_date": "2026-09-05",
    "paid_at": "2026-09-14T18:00:00", "paid_period_start": "2026-09-01",
    "paid_period_end": "2026-09-14", "qb_status": "entered",
    "qb_entered_at": "2026-09-15T09:00:00", "qb_entered_by_name": "Office",
})
check("the 25 original columns are untouched", fr.header[:len(OLD_REIMB)] == OLD_REIMB)
r = fr.row()
check("paid_at lands", "2026-09-14" in str(r.get("paid_at")), str(r.get("paid_at")))
check("the run that paid it lands",
      r.get("paid_period_start") == "2026-09-01" and r.get("paid_period_end") == "2026-09-14")
check("qb_status lands", r.get("qb_status") == "entered")
check("who keyed it in lands", r.get("qb_entered_by") == "Office", str(r.get("qb_entered_by")))
check("approval is NOT overwritten by payment", r.get("status") == "approved")
check("the amount is still in the amount column", r.get("amount") == 25.0, str(r.get("amount")))

print("\nAn unpaid, un-keyed claim reads blank rather than guessing:")
fr2 = FakeSheet(OLD_REIMB)
fr2.install("Reimbursements")
sx.export_reimbursement_to_sheets(None, {
    "reimbursement_uuid": "r2", "user_name": "Casey", "type": "expense",
    "amount": 10.0, "status": "submitted",
})
r2 = fr2.row()
check("paid_at is blank, not a date", r2.get("paid_at") == "", str(r2.get("paid_at")))
check("qb_status defaults to pending", r2.get("qb_status") == "pending", str(r2.get("qb_status")))

print("\nTips get their own tab:")
ft = FakeSheet([])
ft.install("Tips")
sx.export_tip_to_sheets(None, {
    "tip_uuid": "t1", "user_name": "Casey", "tip_date": "2026-09-09",
    "amount": 40.0, "job_name": "Smith move", "job_uuid": "j-1",
    "note": "customer rang the office", "created_by_name": "Office",
    "created_at": "2026-09-09T10:00:00", "updated_at": "2026-09-09T10:00:00",
})
t = ft.row()
check("the tip row carries the person and the amount",
      t.get("user_name") == "Casey" and t.get("amount") == 40.0, str(t))
check("dated by PAYOUT, which is what picks the pay period",
      t.get("tip_date") == "2026-09-09")
check("the job is recorded for reference", t.get("job_uuid") == "j-1")
check("and who entered it", t.get("entered_by") == "Office")

print("\nIt is in the health-check registry, or nothing watches it:")
keys = {e["key"] for e in sx.SHEET_SYNC_REGISTRY}
check("tips is registered", "tips" in keys)
tips_entry = next(e for e in sx.SHEET_SYNC_REGISTRY if e["key"] == "tips")
check("with its own tab env var so staging cannot write to the prod tab",
      tips_entry["env"] == "SHEETS_TIPS_TAB", str(tips_entry))
check("and the function name the status table keys on",
      tips_entry["fn"] == "export_tip_to_sheets")

print("\nThe Payroll tab: one row per employee, replaced on a re-finalize:")
# The key column is `period`, shared by every employee row in the run, and the
# export deletes the whole period before writing it back. Sparing a SINGLE row
# (the old keep_last flag) would delete everybody except the last person on the
# run - which is why keep_last_n is a count.
fp = FakeSheet([])
fp.install("Payroll")
RUN = {
    "period": "2026-09-01..2026-09-14",
    "period_start": "2026-09-01", "period_end": "2026-09-14",
    "finalized_at": "2026-09-15T09:00:00",
    "employees": [
        {"user_id": 7, "name": "Casey",
         "totals": {"regular_hours": 40, "ot_hours": 2, "pto_hours": 8,
                    "tips_amount": 40.0, "total_hours": 50}},
        {"user_id": 9, "name": "Dev",
         "totals": {"regular_hours": 32, "ot_hours": 0, "pto_hours": 0,
                    "tips_amount": 0.0, "total_hours": 32}},
    ],
}
n = sx.export_payroll_period_to_sheets(None, RUN)
check("one row per employee", n == 2, str(n))
r0, r1 = fp.row(0), fp.row(1)
check("the period key is on every row",
      r0.get("period") == "2026-09-01..2026-09-14" == r1.get("period"))
check("tips are a COLUMN on the payroll row", r0.get("tips_amount") == 40.0, str(r0))
check("PTO is too", r0.get("pto_hours") == 8)
check("and the employee is named", {r0.get("employee"), r1.get("employee")} == {"Casey", "Dev"})
# Identity by KEY, not by name. Payroll joins on the roster id everywhere else so
# a rename cannot detach somebody from their hours; a money tab keyed on a
# display name alone cannot tell two people with the same name apart.
check("the roster id travels with the row",
      {r0.get("user_id"), r1.get("user_id")} == {7, 9}, f"{r0.get('user_id')}/{r1.get('user_id')}")
check("row_key is unique per row, unlike period",
      r0.get("row_key") != r1.get("row_key")
      and r0.get("row_key") == "2026-09-01..2026-09-14:7",
      f"{r0.get('row_key')} / {r1.get('row_key')}")
check("which is what lets the nightly integrity check see a duplicate here",
      r0.get("period") == r1.get("period"),
      "period repeats by design, so it cannot be the duplicate key")

print("\nA re-finalize replaces the run rather than duplicating it:")
deleted = []
sx._delete_sheet_rows_by_value = lambda svc, sid, tab, col, val, keep_last_n=0: (
    deleted.append((col, val, keep_last_n)) or 0)
fp.written.clear()
sx.export_payroll_period_to_sheets(None, RUN)
check("the stale rows are dropped by PERIOD, not per employee",
      deleted and deleted[-1][0] == "period" and deleted[-1][1] == RUN["period"],
      str(deleted))
check("sparing exactly the rows just appended, not one",
      deleted[-1][2] == 2, f"keep_last_n={deleted[-1][2]} for a 2-employee run")

print("\nA broken header refuses to append rather than piling up duplicates:")
# The dedupe key IS PAYROLL_HEADERS[0], so _ensure_tab itself raises on a
# populated header row that has lost it, before anything is appended - the same
# protection that stops a renamed row 1 turning an append-first export into the
# Reimbursements cascade (189 duplicate rows, $17,088 over-counted). The export
# therefore carries NO second guard of its own; one would be unreachable, and an
# unreachable check reads as protection that is not there.
#
# Exercised against the REAL _ensure_tab: the FakeSheet stub appends missing
# columns exactly as the real one does, so it never reaches the guard, and a test
# written against the stub would have reported this as working either way.
sx._ensure_tab = _REAL_ENSURE
sx._get_sheets_svc = lambda db: object()
sx._sheet_ids = lambda svc, sid, refresh=False: {"Payroll": 1}
sx._header_cache_get = lambda sid, tab: ["something_else", "another"]
appended = []
sx._api = lambda fn: appended.append("wrote")
try:
    sx.export_payroll_period_to_sheets(None, RUN)
    check("a populated header missing the key column raises", False, "it appended anyway")
except sx.SheetHeaderError as exc:
    check("a populated header missing the key column raises", True)
    # Names PAYROLL_HEADERS[0], which is now `row_key` - and that is the
    # improvement: the column _ensure_tab protects is the genuinely unique one,
    # not `period`, which every employee on the run shares.
    check("the message names the key column and says to fix the sheet",
          sx.PAYROLL_HEADERS[0] in str(exc) and "fix the header" in str(exc), str(exc))
check("and nothing was written", appended == [], str(appended))

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
