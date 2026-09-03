"""The Bills rebuild must be visible to the export-pool readout (vet finding F2).
`python scripts/test_bills_rebuild_pool_visibility.py`

WHY THIS EXISTS. `_bills_rebuild_worker` submits straight to the export pool
rather than going through `run_export_in_background`, which is the only thing
that registers a task in `_inflight`. So the Sheet Backfill panel reported the
pool idle while a rebuild held one of its two threads - the readout the runbook
sends you to when a backfill will not drain, blind to the one task it most
needed to show.

A leak here is worse than the blindness: a key never popped reads as permanently
saturated, and every diagnosis made from that panel afterwards is wrong. So the
release path is asserted on success, on a raise, and after a coalesced rerun.

Runs against fakes: no network, no credentials, no database.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


import app.integrations.sheets_export as sx
import app.db.session as dbsession

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("  -- " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


class FakeDb:
    def close(self): pass
    def rollback(self): pass
    def execute(self, *a, **k): return None
    def commit(self): pass


dbsession.SessionLocal = lambda: FakeDb()
sx.record_sheet_sync = lambda *a, **k: None
sx._clear_bills_rebuild_pending = lambda db, ju: None

seen = {}


def fake_rebuild(db, job_uuid):
    seen['stats'] = sx.export_pool_status()
    seen['keys'] = list(sx._inflight.keys())
    return 1


sx.rebuild_job_materials_total_in_bills = fake_rebuild

before = sx.export_pool_status()
check("pool readout is idle before the run", before["running"] == 0, str(before))

sx._bills_rebuild_in_flight.add("job-X")
sx._bills_rebuild_worker("job-X")

check("rebuild is visible to the pool readout WHILE it runs",
      seen['stats']["running"] == 1, str(seen.get('stats')))
check("it registers under its own function name",
      any(k.startswith("rebuild_job_materials_total_in_bills#") for k in seen['keys']),
      str(seen.get('keys')))

after = sx.export_pool_status()
check("deregisters when done (no leak)", after["running"] == 0, str(after))
check("coalescer state is released", "job-X" not in sx._bills_rebuild_in_flight)

# a rebuild that RAISES must still deregister, or the readout reads
# permanently saturated and every later diagnosis is wrong
def raising(db, job_uuid):
    raise RuntimeError("sheets exploded")


sx.rebuild_job_materials_total_in_bills = raising
sx.note_export_failure = lambda *a, **k: None
sx._bills_rebuild_in_flight.add("job-Y")
sx._bills_rebuild_worker("job-Y")
after2 = sx.export_pool_status()
check("a raised rebuild still deregisters", after2["running"] == 0, str(after2))

# a rerun loops inside the same worker: each pass must register and release
passes = []


def counting(db, job_uuid):
    passes.append(sx.export_pool_status()["running"])
    if len(passes) == 1:
        sx._bills_rebuild_rerun.add(job_uuid)
    return 1


sx.rebuild_job_materials_total_in_bills = counting
sx._bills_rebuild_in_flight.add("job-Z")
sx._bills_rebuild_worker("job-Z")
check("a coalesced rerun registers once per pass, never stacking",
      passes == [1, 1], str(passes))
check("no leak after a rerun", sx.export_pool_status()["running"] == 0)

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
