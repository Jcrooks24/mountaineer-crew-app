"""Offline checks for the two concurrency hazards in the replace-style exports.
`python scripts/test_row_delete_race.py`

WHY THIS EXISTS. Both hazards need two writers hitting one tab at the same
moment, which `sheets_smoke_test.py` cannot produce - it hits real Sheets,
serially, and passes with either bug fully present.

1. `_delete_rows_matching` - row indices going stale between the read and the
   delete. Failed 37 times in one day in production, and the only evidence was
   a 400 in an in-memory failure ring.
2. `schedule_job_materials_bills_rebuild` - a burst of rebuilds for one job
   racing into two Materials lines on the Bills tab, which is a doubled
   materials charge on an invoice.

Both run against fakes: no network, no credentials, no database.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.integrations import sheets_export as se  # noqa: E402


class FakeResp:
    def __init__(self, status):
        self.status = status


class FakeHttpError(Exception):
    """Shaped like googleapiclient.errors.HttpError: a .resp with a status, and
    the API's message in str()."""

    def __init__(self, status, message):
        super().__init__(message)
        self.resp = FakeResp(status)


def stale_error(index, rows):
    return FakeHttpError(400, (
        "<HttpError 400 when requesting https://sheets.googleapis.com/v4/spreadsheets/"
        "x:batchUpdate?alt=json returned \"Invalid requests[0].deleteDimension: Cannot "
        f"delete a row that doesn't exist. Tried to delete row index {index} but there "
        f"are only {rows} rows.\"."
    ))


class FakeSheets:
    """A one-column grid that records deletes and can shrink mid-flight.

    `shrink_before` is the number of successful reads after which another writer
    is simulated as having removed the tail of the grid - which is exactly what
    two export threads do to each other.
    """

    def __init__(self, column, shrink_before=None, shrink_by=0):
        self.column = list(column)
        self.reads = 0
        self.batches = 0
        self.deleted = []
        self.shrink_before = shrink_before
        self.shrink_by = shrink_by

    # -- the fluent googleapiclient surface, only as far as this code walks it --
    def spreadsheets(self):
        return self

    def values(self):
        return self

    def get(self, spreadsheetId=None, range=None):
        self.reads += 1
        return _Exec(lambda: {"values": [[v] for v in self.column]})

    def batchUpdate(self, spreadsheetId=None, body=None):
        def _run():
            self.batches += 1
            if self.shrink_before is not None and self.batches <= self.shrink_before:
                # Another writer got there first: the grid is now shorter than
                # the indices this batch was built from.
                del self.column[len(self.column) - self.shrink_by:]
                raise stale_error(len(self.column), len(self.column))
            for req in body["requests"]:
                idx = req["deleteDimension"]["range"]["startIndex"]
                if idx >= len(self.column):
                    raise stale_error(idx, len(self.column))
                self.deleted.append(self.column[idx])
                del self.column[idx]
            return {}
        return _Exec(_run)


class _Exec:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


failures = 0


def check(name, actual, expected):
    global failures
    ok = actual == expected
    if not ok:
        failures += 1
    print(("PASS  " if ok else "FAIL  ") + name +
          ("" if ok else f"\n        expected {expected!r}\n        got      {actual!r}"))


def finder(svc, target):
    """Mirrors what the real call sites pass: re-reads the column every time."""
    def _find():
        res = svc.spreadsheets().values().get(spreadsheetId="x", range="T!A:A").execute()
        col = res.get("values") or []
        return [i for i, row in enumerate(col) if i > 0 and (row[0] if row else "") == target]
    return _find


# The 400 is recognised, and nothing else is mistaken for it.
check("stale-index 400 is recognised",
      se._is_stale_row_index_error(stale_error(1372, 1372)), True)
check("a 400 about something else is not",
      se._is_stale_row_index_error(FakeHttpError(400, "Invalid value at 'data'")), False)
check("a 429 is not a stale index",
      se._is_stale_row_index_error(FakeHttpError(429, "RATE_LIMIT_EXCEEDED")), False)
check("a bare exception is not a stale index",
      se._is_stale_row_index_error(RuntimeError("boom")), False)

# Ordinary delete: two matching rows, both removed.
svc = FakeSheets(["submission_id", "a", "MARK", "b", "MARK", "c"])
n = se._delete_rows_matching(svc, "sid", "T", 7, finder(svc, "MARK"))
check("deletes every matching row", n, 2)
check("deletes the right rows", svc.column, ["submission_id", "a", "b", "c"])
check("one batch when nothing races", svc.batches, 1)

# Nothing matches: no batch is issued at all.
svc = FakeSheets(["submission_id", "a", "b"])
check("no match deletes nothing", se._delete_rows_matching(svc, "sid", "T", 7, finder(svc, "MARK")), 0)
check("no match issues no batch", svc.batches, 0)

# THE REGRESSION. Another writer shortens the grid between the read and the
# delete. Before the fix this raised and the caller (rebuild_job_materials_total_
# in_bills) never got as far as appending its row.
svc = FakeSheets(["submission_id", "a", "MARK", "b", "tail1", "tail2"],
                 shrink_before=1, shrink_by=2)
n = se._delete_rows_matching(svc, "sid", "T", 7, finder(svc, "MARK"))
check("a lost race is retried, not raised", n, 1)
check("the retry re-read the column", svc.reads, 2)
check("the row still gets deleted", svc.column, ["submission_id", "a", "b"])

# A grid that keeps moving past the retry budget must still surface the error,
# rather than silently reporting success.
svc = FakeSheets(["submission_id", "MARK", "x", "y", "z"], shrink_before=99, shrink_by=1)
try:
    se._delete_rows_matching(svc, "sid", "T", 7, finder(svc, "MARK"), attempts=3)
    check("gives up loudly after the retry budget", "no exception", "raised")
except FakeHttpError:
    check("gives up loudly after the retry budget", "raised", "raised")
check("gave up after exactly `attempts` batches", svc.batches, 3)

# Duplicate indices from a find would delete two different rows; they are collapsed.
svc = FakeSheets(["id", "MARK", "b"])
check("duplicate indices are collapsed",
      se._delete_rows_matching(svc, "sid", "T", 7, lambda: [1, 1, 1]), 1)
check("only one row actually went", svc.column, ["id", "b"])

# Indices are deleted bottom-up, or each delete shifts the next one.
svc = FakeSheets(["id", "r1", "r2", "r3", "r4"])
se._delete_rows_matching(svc, "sid", "T", 7, lambda: [1, 3])
check("bottom-up ordering removes the intended rows", svc.column, ["id", "r2", "r4"])


# ── Coalescing the Bills rebuild ─────────────────────────────────────────────
# The delete and the append are two calls, and the tab lock only covers the
# first. Coalescing is what keeps a second worker out of the gap between them.

import threading  # noqa: E402

runs = []
runs_lock = threading.Lock()
started = threading.Event()
release = threading.Event()


def fake_rebuild(db, job_uuid):
    with runs_lock:
        runs.append(job_uuid)
    started.set()
    # Hold the first worker open so the burst arrives while it is still running,
    # which is the only window in which coalescing can do anything.
    release.wait(timeout=5)


se.rebuild_job_materials_total_in_bills = fake_rebuild
se.record_sheet_sync = lambda *a, **k: None

JOB = "3f8c1e22-0000-4a11-9b77-0f1e2d3c4b5a"

# Four rapid rebuilds for one job, the shape a draining offline queue produces.
for _ in range(4):
    se.schedule_job_materials_bills_rebuild(JOB)
started.wait(timeout=5)
release.set()

# Wait for the in-flight worker (plus its single rerun) to finish.
for _ in range(100):
    with se._bills_rebuild_lock:
        idle = JOB not in se._bills_rebuild_in_flight
    if idle:
        break
    threading.Event().wait(0.05)

check("a burst of 4 rebuilds collapses to 2 runs (one + one rerun)", len(runs), 2)
check("and every run was for the right job", set(runs), {JOB})
with se._bills_rebuild_lock:
    check("the in-flight set is left clean", JOB in se._bills_rebuild_in_flight, False)
    check("the rerun set is left clean", JOB in se._bills_rebuild_rerun, False)

check("an empty job_uuid schedules nothing",
      se.schedule_job_materials_bills_rebuild("") is None, True)

# A failing rebuild must still clear its in-flight entry, or that job's Bills
# line is never rebuilt again for the life of the worker.
def boom(db, job_uuid):
    raise RuntimeError("sheets exploded")


se.rebuild_job_materials_total_in_bills = boom
se.note_export_failure = lambda *a, **k: None
OTHER = "9a1b2c3d-1111-4e55-8f99-aabbccddeeff"
se.schedule_job_materials_bills_rebuild(OTHER)
for _ in range(100):
    with se._bills_rebuild_lock:
        idle = OTHER not in se._bills_rebuild_in_flight
    if idle:
        break
    threading.Event().wait(0.05)
with se._bills_rebuild_lock:
    check("a raising rebuild still releases its in-flight slot",
          OTHER in se._bills_rebuild_in_flight, False)

print("\nAll checks passed." if failures == 0 else f"\n{failures} check(s) FAILED.")
sys.exit(0 if failures == 0 else 1)
