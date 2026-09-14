"""Offline checks that a row written to the Sheet stays there, and that a row the
Sheet lost can be put back.
`python scripts/test_sheet_row_fidelity.py`

WHY THIS EXISTS. On prod, 2026-09-14, the backfill page reported 40 records that
would not drain. Measured against Postgres and the live Sheet:

  * 29 of the 33 Bills were bills with no line items. They owe the sheet no row,
    so the audit could never stop counting them.
  * 4 Bills, 5 Materials, 1 DVIR and 1 prior on-duty statement were marked
    exported and absent from their tabs. Their exports skip on that marker, so
    Re-send did nothing, silently, forever.
  * The rows were lost by `_write_rows_top`: insert a blank row, then write the
    fixed range A2, as two calls. Two writers interleaving overwrote one row, and
    an insert inside a keyed delete's read-then-delete moved the delete onto a
    neighbour's row.

No network, no credentials, no database.
"""

import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.integrations import sheets_export as se  # noqa: E402
from app.integrations import sheet_backfill as sb  # noqa: E402

failures = 0


def check(name, actual, expected):
    global failures
    ok = actual == expected
    if not ok:
        failures += 1
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"\n        expected {expected!r}\n        got      {actual!r}"))


# ── 1. Empty records owe the sheet nothing ───────────────────────────────────

check("no items is not owed a row", sb._has_items("[]"), False)
check("null items is not owed a row", sb._has_items(None), False)
check("one item is owed a row", sb._has_items('[{"label": "Truck"}]'), True)
check("corrupt JSON stays visible to the audit", sb._has_items("{not json"), True)


# ── 2. The insert and the values travel as one atomic batch ──────────────────

reqs = se._top_insert_requests(7, [["a", 3, True, "", None, "=SUM(1,2)"]])
check("one batch carries the insert and the values", [next(iter(r)) for r in reqs],
      ["insertDimension", "updateCells"])
check("the insert is directly below the header",
      (reqs[0]["insertDimension"]["range"]["startIndex"],
       reqs[0]["insertDimension"]["range"]["endIndex"]), (1, 2))
check("the values land in the inserted row", reqs[1]["updateCells"]["start"],
      {"sheetId": 7, "rowIndex": 1, "columnIndex": 0})
cells = reqs[1]["updateCells"]["rows"][0]["values"]
check("text stays text", cells[0], {"userEnteredValue": {"stringValue": "a"}})
check("numbers stay numbers", cells[1], {"userEnteredValue": {"numberValue": 3}})
check("booleans stay booleans, not 1", cells[2], {"userEnteredValue": {"boolValue": True}})
check("an empty string leaves the cell empty", cells[3], {})
check("None leaves the cell empty", cells[4], {})
check("a leading = is literal text, as RAW wrote it", cells[5],
      {"userEnteredValue": {"stringValue": "=SUM(1,2)"}})

# Vet 2026-09-14: the old path failed on these (JSON encoding); str() would have
# written a money total as text and a timestamp in a second format, silently.
from datetime import datetime, timezone  # noqa: E402
from decimal import Decimal  # noqa: E402
for bad in (Decimal("45.00"), datetime(2026, 3, 28, tzinfo=timezone.utc), [1], {"a": 1}):
    try:
        se._cell(bad)
        check(f"a {type(bad).__name__} fails loudly instead of becoming text", "no error", "TypeError")
    except TypeError:
        check(f"a {type(bad).__name__} fails loudly instead of becoming text", "TypeError", "TypeError")

# And the Materials re-export now sends the live shapes: ISO text and a float.
import json as _json  # noqa: E402
captured = []
sb_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "app", "integrations", "sheet_backfill.py"), encoding="utf-8").read()
check("the Materials re-export sends created_at as ISO text",
      '"created_at": row.created_at.isoformat() if row.created_at else "",' in sb_src, True)
check("the Materials re-export sends the total as a number",
      '"total": float(row.total or 0),' in sb_src, True)


class Grid:
    """A tab as a list of rows, driven through the googleapiclient surface the
    export code walks. A batch is applied atomically, the way Sheets applies one,
    and `hold` lets a test park a writer inside a call to force an interleaving."""

    def __init__(self, rows):
        self.rows = [list(r) for r in rows]
        self.batches = 0
        self.value_updates = 0
        self.hold = None  # (event_to_set, event_to_wait) inside the next batch
        self.lock = threading.Lock()

    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, range=None):
        return _Exec(lambda: {"values": [list(r[:1]) for r in self.rows]})

    def update(self, **kw):
        def _run():
            self.value_updates += 1
        return _Exec(_run)

    def batchUpdate(self, spreadsheetId=None, body=None):
        def _run():
            hold, self.hold = self.hold, None
            if hold:
                hold[0].set()
                hold[1].wait(timeout=5)
            with self.lock:
                self.batches += 1
                for req in body["requests"]:
                    if "insertDimension" in req:
                        r = req["insertDimension"]["range"]
                        for _ in range(r["endIndex"] - r["startIndex"]):
                            self.rows.insert(r["startIndex"], [""])
                    elif "updateCells" in req:
                        start = req["updateCells"]["start"]["rowIndex"]
                        for off, row in enumerate(req["updateCells"]["rows"]):
                            vals = [next(iter(c["userEnteredValue"].values())) if c else ""
                                    for c in row["values"]]
                            self.rows[start + off] = vals
                    elif "deleteDimension" in req:
                        del self.rows[req["deleteDimension"]["range"]["startIndex"]]
            return {}
        return _Exec(_run)


class _Exec:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


se._sheet_ids = lambda svc, sid, refresh=False: {"T": 7}

grid = Grid([["key"]])
se._write_rows_top(grid, "sid", "T", [["r1"]])
check("a top write is a single batch", grid.batches, 1)
check("and no separate values.update", grid.value_updates, 0)
check("the row is there", grid.rows, [["key"], ["r1"]])

# THE LOST-ROW RACE, writer vs writer. Park writer A inside its call, start B.
# Before the fix each writer made two calls, and B's A2 write overwrote A's row.
grid = Grid([["key"], ["old"]])
entered, go = threading.Event(), threading.Event()
grid.hold = (entered, go)
a = threading.Thread(target=se._write_rows_top, args=(grid, "sid", "T", [["A"]]))
a.start()
entered.wait(timeout=5)
b = threading.Thread(target=se._write_rows_top, args=(grid, "sid", "T", [["B"]]))
b.start()
b.join(timeout=0.3)
check("a second writer waits for the tab", b.is_alive(), True)
go.set()
a.join(timeout=5)
b.join(timeout=5)
check("both concurrent rows survive", sorted(r[0] for r in grid.rows[1:]), ["A", "B", "old"])
check("and no blank residue row is left", any(r == [""] for r in grid.rows), False)

# THE WRONG-ROW DELETE, insert vs keyed delete. The delete reads its indices,
# then an insert arrives before it deletes. Without the shared tab lock, the
# delete removed the row above its target.
grid = Grid([["key"], ["keep1"], ["TARGET"], ["keep2"]])
found, release = threading.Event(), threading.Event()


def slow_find():
    idx = [i for i, r in enumerate(grid.rows) if i > 0 and r[0] == "TARGET"]
    found.set()
    release.wait(timeout=5)  # the insert tries to land right here
    return idx


d = threading.Thread(target=se._delete_rows_matching, args=(grid, "sid", "T", 7, slow_find))
d.start()
found.wait(timeout=5)
w = threading.Thread(target=se._write_rows_top, args=(grid, "sid", "T", [["NEW"]]))
w.start()
w.join(timeout=0.3)
check("an insert cannot land inside a delete's read-then-delete", w.is_alive(), True)
release.set()
d.join(timeout=5)
w.join(timeout=5)
check("the delete removed its target and nothing else",
      sorted(r[0] for r in grid.rows[1:]), ["NEW", "keep1", "keep2"])


# ── 3. Re-send clears a lying marker, and only when a human asked ────────────

cleared, reexported = [], []
entry = sb._entry_for("bills")
entry["source"] = lambda db: [{"id": "absent"}, {"id": "landed"}]
entry["reexport"] = lambda db, ref: reexported.append(ref)
sb.MARKER_CLEARERS["bills"] = lambda db, rid: cleared.append(rid) or 1
sb.note_backfill_queued = lambda n: None
audits = []


def fake_audit(db):
    audits.append(1)
    return {"connected": True, "results": [
        {"key": "bills", "missing": [{"id": "absent"}], "missing_count": 1},
    ]}


sb.audit_sheet_backfill = fake_audit
sb.backfill_cooldown_remaining = lambda: 0


class FakeDB:
    def commit(self):
        pass

    def rollback(self):
        pass


db = FakeDB()

res = sb.reexport_missing(db, "bills", ["absent", "landed"], clear_markers=True)
check("a human Re-send clears the marker of an absent record", cleared, ["absent"])
check("but never of one the fresh audit sees in the sheet", "landed" in cleared, False)
check("stale ids from the page trigger a fresh audit", len(audits), 1)
check("both are still re-driven", reexported, ["absent", "landed"])
check("the result says how many markers were cleared", res["markers_cleared"], 1)

cleared.clear()
sb.reexport_missing(db, "bills", ["absent"])
check("without clear_markers nothing is cleared", cleared, [])

cleared.clear()
sb.reconcile_all_missing(db)
check("the unattended sweep never clears a marker", cleared, [])

cleared.clear()
audits.clear()
sb.reconcile_all_missing(db, max_total=100, clear_markers=True)
check("Drain all clears absent markers", cleared, ["absent"])
check("and reuses its own audit instead of auditing twice", len(audits), 1)

admin_src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              "app", "routers", "admin.py"), encoding="utf-8").read()
check("the Re-send endpoint opts in",
      "reexport_missing(db, body.key, body.ids, clear_markers=True)" in admin_src, True)
check("the Drain all endpoint opts in",
      "max_total=MAX_REEXPORT_PER_REQUEST, clear_markers=True)" in admin_src, True)
check("every marker-gated export has a clearer",
      set(k for k in ("materials", "bills", "dvirs", "prior_hours")) <= set(sb.MARKER_CLEARERS), True)

print("\nAll checks passed." if failures == 0 else f"\n{failures} check(s) FAILED.")
sys.exit(0 if failures == 0 else 1)
