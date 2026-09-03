"""Durability checks for the Bills materials rebuild (vet findings F1 + F7).
`python scripts/test_bills_rebuild_durability.py`

WHY THIS EXISTS. Three failures that no happy-path test can reach, each named
with the production symptom it would have caught:

1. ORDERING. The rebuild used to delete the old Materials line before appending
   the new one. Render recycles this worker every 1000 requests by design, so a
   crash between the two is scheduled, not hypothetical - and it left the job
   with NO materials charge on the Bills tab. Silent under-billing: an
   under-billed job does not look like an error, it looks like a smaller job.

2. LOST WORK. The coalescer keeps its pending-rerun set in process memory. A
   rerun registered just before a recycle was gone, and a rebuild that raised was
   abandoned. Nothing re-drove either, so the Bills total stayed stale until
   somebody happened to edit that job's materials again.

3. UNBOUNDED APPEND. Append-first makes a crash survivable, but it also means a
   delete that fails DETERMINISTICALLY leaves the appended row and the reconciler
   re-drives minutes later - append, fail, append, fail. That is exactly how the
   Reimbursements tab reached 189 duplicate rows and a $17,088 over-count. The
   header is checked before anything is written.

Runs against fakes and an in-memory SQLite: no network, no credentials, no
Postgres. See ADR 0043.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import app.integrations.sheets_export as sx
from app.db.sheet_exports import ensure_sheet_exports_tables

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -- " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# --------------------------------------------------------------------------
# 1. keep_last spares the bottom-most match (the row just appended)
# --------------------------------------------------------------------------
class FakeExec:
    def __init__(self, payload): self.payload = payload
    def execute(self): return self.payload


class FakeValues:
    def __init__(self, outer): self.outer = outer
    def get(self, spreadsheetId=None, range=None, **kw):
        if range.endswith("!1:1"):
            return FakeExec({"values": [self.outer.headers]})
        return FakeExec({"values": self.outer.column})
    def append(self, **kw):
        self.outer.appended.append(kw.get("body", {}).get("values"))
        return FakeExec({})


class FakeSheets:
    def __init__(self, outer): self.outer = outer
    def values(self): return FakeValues(self.outer)
    def batchUpdate(self, spreadsheetId=None, body=None):
        self.outer.batches.append(body)
        return FakeExec({})


class FakeSvc:
    def __init__(self, headers, column):
        self.headers, self.column = headers, column
        self.batches, self.appended = [], []
    def spreadsheets(self): return FakeSheets(self)


def deleted_indices(svc):
    out = []
    for b in svc.batches:
        for r in b.get("requests", []):
            out.append(r["deleteDimension"]["range"]["startIndex"])
    return sorted(out)


HEADERS = ["job_uuid", "item_label", "submission_id"]
MARKER = "job-matmarker"
# rows 1,3,5 carry the marker; row 5 is the bottom-most (the fresh append)
COLUMN = [["submission_id"], [MARKER], ["other"], [MARKER], ["other"], [MARKER]]

sx._sheet_ids = lambda svc, sid, refresh=False: {"Bills": 7}

svc = FakeSvc(HEADERS, COLUMN)
n = sx._delete_sheet_rows_by_value(svc, "sid", "Bills", "submission_id", MARKER)
check("keep_last=False deletes every match", deleted_indices(svc) == [1, 3, 5],
      f"got {deleted_indices(svc)}")

svc = FakeSvc(HEADERS, COLUMN)
n = sx._delete_sheet_rows_by_value(svc, "sid", "Bills", "submission_id", MARKER, keep_last=True)
check("keep_last=True spares the bottom-most match", deleted_indices(svc) == [1, 3],
      f"got {deleted_indices(svc)}")

svc = FakeSvc(HEADERS, [["submission_id"], ["other"]])
sx._delete_sheet_rows_by_value(svc, "sid", "Bills", "submission_id", MARKER, keep_last=True)
check("keep_last with no matches deletes nothing", deleted_indices(svc) == [])

svc = FakeSvc(HEADERS, [["submission_id"], [MARKER]])
sx._delete_sheet_rows_by_value(svc, "sid", "Bills", "submission_id", MARKER, keep_last=True)
check("keep_last with ONE match (the fresh row) deletes nothing", deleted_indices(svc) == [])

# --------------------------------------------------------------------------
# 2. append happens BEFORE the stale delete
# --------------------------------------------------------------------------
order = []
real_delete = sx._delete_sheet_rows_by_value


class OrderSvc(FakeSvc):
    def spreadsheets(self):
        outer = self

        class V(FakeValues):
            def append(self, **kw):
                order.append("append")
                return FakeExec({})

        class S(FakeSheets):
            def values(self): return V(outer)

        return S(outer)


sx._delete_sheet_rows_by_value = lambda *a, **k: order.append("delete") or 0
sx._ensure_tab = lambda svc, sid, tab, headers: headers
sx._get_sheets_svc = lambda db: OrderSvc(HEADERS, COLUMN)
sx._entry_status_for = lambda db, ju: ("", "")


class FakeQ:
    def filter(self, *a): return self
    def all(self): return [(12.5,), (7.5,)]


class FakeDb:
    def query(self, *a): return FakeQ()


wrote = sx.rebuild_job_materials_total_in_bills(FakeDb(), "job-1")
check("rebuild writes a row when a total exists", wrote == 1)
check("append runs BEFORE the stale delete", order == ["append", "delete"], f"got {order}")

order.clear()


class FakeQZero(FakeQ):
    def all(self): return []


class FakeDbZero:
    def query(self, *a): return FakeQZero()


wrote = sx.rebuild_job_materials_total_in_bills(FakeDbZero(), "job-1")
check("zero-total job writes nothing and still deletes", wrote == 0 and order == ["delete"],
      f"wrote={wrote} order={order}")

# A broken header must fail BEFORE the append, or a deterministic delete failure
# turns the reconciler's every-5-minutes retry into the Reimbursements pile-up
# (189 duplicate rows, $17,088 over-counted) with append-first ordering.
order.clear()
sx._ensure_tab = lambda svc, sid, tab, headers: ["job_uuid", "item_label"]  # no submission_id
raised = None
try:
    sx.rebuild_job_materials_total_in_bills(FakeDb(), "job-1")
except Exception as e:
    raised = e
check("a header missing the dedupe column raises",
      raised is not None and type(raised).__name__ == "SheetHeaderError", repr(raised))
check("and it raises BEFORE anything is appended", order == [], f"got {order}")

sx._ensure_tab = lambda svc, sid, tab, headers: headers
sx._delete_sheet_rows_by_value = real_delete

# --------------------------------------------------------------------------
# 3. durable marker survives, and the reconciler re-drives it
# --------------------------------------------------------------------------
engine = create_engine("sqlite://")
ensure_sheet_exports_tables(engine)
Session = sessionmaker(bind=engine)
db = Session()

scheduled = []
real_schedule = sx.schedule_job_materials_bills_rebuild
sx.schedule_job_materials_bills_rebuild = lambda ju, d=None: scheduled.append(ju)

sx._mark_bills_rebuild_pending(db, "job-A")
sx._mark_bills_rebuild_pending(db, "job-A")   # idempotent
sx._mark_bills_rebuild_pending(db, "job-B")
rows = db.execute(text("SELECT export_key FROM sheet_generic_exports WHERE kind=:k"),
                  {"k": sx._BILLS_PENDING_KIND}).fetchall()
check("marker is idempotent (one row per job)", sorted(r[0] for r in rows) == ["job-A", "job-B"],
      f"got {rows}")

res = sx.reconcile_job_materials_bills(db)
check("reconciler re-drives every pending job", sorted(scheduled) == ["job-A", "job-B"],
      f"got {scheduled}")
check("reconciler reports pending/queued", res["pending"] == 2 and res["queued"] == 2, str(res))

sx._clear_bills_rebuild_pending(db, "job-A")
scheduled.clear()
res = sx.reconcile_job_materials_bills(db)
check("cleared marker is not re-driven", scheduled == ["job-B"], f"got {scheduled}")

sx._clear_bills_rebuild_pending(db, "job-B")
scheduled.clear()
res = sx.reconcile_job_materials_bills(db)
check("steady state re-drives nothing", scheduled == [] and res["pending"] == 0, str(res))

res = sx.reconcile_job_materials_bills(db, max_jobs=1)
sx._mark_bills_rebuild_pending(db, "job-C")
sx._mark_bills_rebuild_pending(db, "job-D")
scheduled.clear()
res = sx.reconcile_job_materials_bills(db, max_jobs=1)
check("max_jobs bounds one cycle", len(scheduled) == 1 and res["queued"] == 1, str(res))

sx.schedule_job_materials_bills_rebuild = real_schedule

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
