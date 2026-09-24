"""Verify rental truck records: entered once, offered in the list, linked per job.

    python backend/scripts/verify_rental_truck_records.py

Drives the real FastAPI routes against a throwaway SQLite file. No Postgres, no
network: the Sheets writes are captured instead of sent.

WHAT IT GUARDS (ADR 0055). A rental is entered once, usually at the pre-trip
DVIR, and then offered in the truck list as "Rental*<job name>" so a multi-day
job does not re-enter it. The regressions to fear:

  - a second record for the same truck (retried submit, second phone, header and
    DVIR both creating it), which splits the truck's job history
  - a later save blanking a detail someone entered, or a stale header save
    unlinking the truck from the job
  - the plate changing after an inspection, which splits the ADR 0053
    inspection history the lockout depends on
  - a returned or idle truck staying in the list, or a live one vanishing early
  - an owned unit being touched at all
"""

import os
import sys
import tempfile
from datetime import timedelta
from types import SimpleNamespace

_tmp = tempfile.mkdtemp()
os.environ.pop("DATABASE_URL", None)
os.environ["SQLITE_PATH"] = os.path.join(_tmp, "verify_rentals.db")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


# ── App under test ───────────────────────────────────────────────────────────

import app.integrations.sheets_export as sx  # noqa: E402

SHEET_ROWS = []


class _Svc:
    pass


def _capture_background(fn, payload, **kw):
    # Run the export inline against a fake Sheets service so the row it would
    # write can be inspected.
    if fn is sx.export_rental_truck_to_sheets:
        fn(None, payload)


sx.run_export_in_background = _capture_background
sx._get_sheets_svc = lambda db: _Svc()
sx._ensure_tab = lambda svc, sid, tab, headers: list(headers)
sx._delete_sheet_rows_by_value = lambda *a, **k: None
sx._write_rows_top = lambda svc, sid, tab, rows: SHEET_ROWS.append((tab, rows[0]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app as api  # noqa: E402
from app.core.deps import get_current_user  # noqa: E402
from app.db.session import Base, engine, SessionLocal  # noqa: E402
from app.db.models.system_config import SystemConfig  # noqa: E402
from app.db.models.rental_truck import RentalTruck, RentalTruckJob  # noqa: E402
from app.db.models.dvir import DVIR  # noqa: E402

import app.routers.dvir as dvir_router  # noqa: E402
import app.routers.rentals as rentals_router  # noqa: E402
import app.routers.job_setup  # noqa: E402,F401

dvir_router.run_export_in_background = _capture_background
rentals_router.schedule_rental_truck_export = sx.schedule_rental_truck_export

Base.metadata.create_all(bind=engine)

USER = SimpleNamespace(id=7, name="Pat Lee", email="pat@example.com", role="crew", is_active=True)
api.dependency_overrides[get_current_user] = lambda: USER
client = TestClient(api)

with SessionLocal() as db:
    db.add(SystemConfig(
        key="vehicle_units",
        value='[{"name": "RENTAL", "is_rental": true}, {"name": "26INT"}]',
    ))
    db.commit()


def dvir(dvir_id, unit, plate=None, job=None, job_name=None, rental_uuid=None,
         kind="pre-trip", returned=False, gvwr=None, company=None):
    return client.post("/api/dvir", json={
        "dvir_id": dvir_id, "vehicle_number": unit, "vehicle_identifier": plate,
        "rental_uuid": rental_uuid, "rental_company": company, "gvwr_lbs": gvwr,
        "job_uuid": job, "job_name": job_name, "rental_returned": returned,
        "inspection_type": kind, "inspection_date": "2026-09-24",
        "condition": "satisfactory", "back_of_truck_confirmed": True,
        "driver_name": "Pat Lee", "driver_signature": "data:image/png;base64,x",
        "driver_signed_at": "2026-09-24T14:00:00Z",
    })


def active():
    return client.get("/api/rentals").json()["rentals"]


def count(model):
    with SessionLocal() as db:
        return db.query(model).count()


# ── Entered at the DVIR ──────────────────────────────────────────────────────

def entered_at_dvir():
    r = dvir("d1", "RENTAL", "MT 4B-123", job="job-smith", job_name="Smith LD",
             rental_uuid="r-new-1", gvwr=25999, company="Penske")
    check("a rental DVIR with a new plate is accepted", r.status_code == 201, f"{r.status_code} {r.text[:120]}")
    body = r.json()
    check("the report is linked to the new record", body.get("rental_uuid") == "r-new-1")
    check("the report keeps its own snapshot of the plate", body.get("vehicle_identifier") == "MT 4B-123")

    lst = active()
    check("the truck appears in the truck list", len(lst) == 1 and lst[0]["plate"] == "MT 4B-123")
    check("its label job is the job it was entered on", lst and lst[0]["latest_job_name"] == "Smith LD")

    r2 = dvir("d1", "RENTAL", "MT 4B-123", job="job-smith", rental_uuid="r-new-1")
    check("a retried submit is idempotent", r2.status_code == 201 and count(RentalTruck) == 1 and count(DVIR) == 1)

    r3 = dvir("d2", "RENTAL", "mt4b123", job="job-smith", rental_uuid="r-other-phone")
    check("the same truck entered on another phone joins the record",
          r3.json().get("rental_uuid") == "r-new-1" and count(RentalTruck) == 1,
          f"records: {count(RentalTruck)}")
    check("a report on the joined record carries the details entered first",
          r3.json().get("gvwr_lbs") == 25999 and r3.json().get("rental_company") == "Penske")

    r4 = dvir("d-noplate", "RENTAL", None, job="job-smith")
    check("a rental DVIR with no plate is still refused", r4.status_code == 400)


# ── Reused on a second job ───────────────────────────────────────────────────

def reused_on_second_job():
    r = dvir("d3", "RENTAL", "MT 4B-123", job="job-jones", job_name="Jones LD", rental_uuid="r-new-1")
    check("picking the truck on a new job is accepted", r.status_code == 201)
    lst = active()
    check("still one truck in the list", len(lst) == 1)
    check("the label moves to the most recent job", lst and lst[0]["latest_job_name"] == "Jones LD")
    jobs = [j["job_name"] for j in (lst[0]["jobs"] if lst else [])]
    check("the record shows both jobs", set(jobs) == {"Smith LD", "Jones LD"}, str(jobs))
    check("linking to a new job does not wait for the first to close", count(RentalTruckJob) == 2)

    fj = client.get("/api/rentals/for-job/job-smith").json()["rentals"]
    check("the first job still lists the truck", len(fj) == 1 and fj[0]["rental_uuid"] == "r-new-1")

    prev = client.get("/api/dvir/latest-for-vehicle",
                      params={"vehicle_number": "RENTAL", "vehicle_identifier": "MT 4B-123"}).json()
    check("the prior-report review still finds this truck's last report",
          prev and prev.get("dvir_id") == "d3")


# ── The job header ───────────────────────────────────────────────────────────

def header(job, rental=None, units=("RENTAL",), name="Header Job"):
    return client.put(f"/api/job-setup/{job}", json={
        "job_name": name, "job_date": "2026-09-24", "vehicle_unit_names": list(units),
        "rental": rental,
    })


def job_header():
    r = header("job-smith", rental=None, name="Smith LD")
    check("a header save with no rental block succeeds", r.status_code == 200)
    setup = r.json()["setup"]
    check("the header reports the linked truck's plate", (setup.get("rental") or {}).get("plate") == "MT 4B-123")
    check("a save with no rental does not unlink the truck",
          len(client.get("/api/rentals/for-job/job-smith").json()["rentals"]) == 1)

    r = header("job-brown", rental={"rental_uuid": "r-hdr", "plate": "WY 77", "company": "Ryder"}, name="Brown")
    check("a new truck entered at job setup is created and linked",
          r.status_code == 200 and (r.json()["setup"].get("rental") or {}).get("rental_uuid") == "r-hdr")
    check("it appears in the truck list", any(x["rental_uuid"] == "r-hdr" for x in active()))

    r = header("job-brown", rental={"rental_uuid": "r-hdr", "plate": "WY 77", "company": ""}, name="Brown")
    check("a later save never blanks a detail", (r.json()["setup"].get("rental") or {}).get("company") == "Ryder")

    r = header("job-own", rental={"plate": "XX 1"}, units=("26INT",), name="Owned")
    check("a rental block on an owned-truck job creates nothing",
          r.status_code == 200 and not any(x["plate"] == "XX 1" for x in active()))

    r = header("job-brown", rental={"rental_uuid": "r-hdr", "plate": "WY 78"}, name="Brown")
    check("a plate typo is fixable before any inspection",
          (r.json()["setup"].get("rental") or {}).get("plate") == "WY 78")

    header("job-wrong", rental={"rental_uuid": "r-hdr", "plate": "WY 78"}, name="Wrong pick")
    r = client.delete("/api/rentals/r-hdr/jobs/job-wrong")
    check("a wrong pick with no inspection can be removed from the job",
          r.status_code == 200 and not client.get("/api/rentals/for-job/job-wrong").json()["rentals"])
    r = client.delete("/api/rentals/r-new-1/jobs/job-smith")
    check("a truck inspected on a job stays linked to it", r.status_code == 409)


# ── Plate lock ───────────────────────────────────────────────────────────────

def plate_lock():
    r = client.put("/api/rentals/r-new-1", json={"unit_name": "RENTAL", "plate": "DIFFERENT 9"})
    check("the plate cannot change once an inspection is filed", r.status_code == 409)
    r = header("job-smith", rental={"rental_uuid": "r-new-1", "plate": "DIFFERENT 9"}, name="Smith LD")
    check("a header save carrying a changed plate is still saved", r.status_code == 200)
    check("and the inspected plate stands", (r.json()["setup"].get("rental") or {}).get("plate") == "MT 4B-123")


# ── Leaving the list ─────────────────────────────────────────────────────────

def leaving_the_list():
    from app.core.rental_trucks import utcnow
    with SessionLocal() as db:
        row = db.query(RentalTruck).filter(RentalTruck.rental_uuid == "r-hdr").first()
        row.last_used_at = utcnow() - timedelta(days=9)
        db.commit()
    check("a truck used 9 days ago is still listed", any(x["rental_uuid"] == "r-hdr" for x in active()))
    with SessionLocal() as db:
        row = db.query(RentalTruck).filter(RentalTruck.rental_uuid == "r-hdr").first()
        row.last_used_at = utcnow() - timedelta(days=11)
        db.commit()
    check("a truck idle for more than 10 days leaves the list", not any(x["rental_uuid"] == "r-hdr" for x in active()))
    check("but it is still on its job", len(client.get("/api/rentals/for-job/job-brown").json()["rentals"]) == 1)

    r = dvir("d4", "RENTAL", "MT 4B-123", job="job-jones", rental_uuid="r-new-1", kind="post-trip", returned=True)
    check("a post-trip can hand the truck back", r.status_code == 201)
    check("a returned truck leaves the list", not any(x["rental_uuid"] == "r-new-1" for x in active()))
    fj = client.get("/api/rentals/for-job/job-jones").json()["rentals"]
    check("the returned truck's record and jobs are kept", len(fj) == 1 and fj[0]["returned_at"])

    r = dvir("d5", "RENTAL", "MT 4B-123", job="job-lee", job_name="Lee", rental_uuid="r-fresh", kind="pre-trip")
    check("the same plate rented again later is a new record",
          r.json().get("rental_uuid") == "r-fresh" and count(RentalTruck) == 3, f"records: {count(RentalTruck)}")

    r = client.post("/api/rentals/r-fresh/return")
    check("marking returned from the list works", r.status_code == 200 and r.json()["rental"]["returned_at"])


# ── Owned trucks ─────────────────────────────────────────────────────────────

def owned_untouched():
    before = count(RentalTruck)
    r = dvir("d-owned", "26INT", None, job="job-own")
    check("an owned-truck DVIR needs no plate", r.status_code == 201)
    check("and creates no rental record", count(RentalTruck) == before and r.json().get("rental_uuid") is None)


# ── The office's copy ────────────────────────────────────────────────────────

def sheet_rows():
    rows = [row for tab, row in SHEET_ROWS if tab == "RentalTrucks"]
    check("rental trucks are exported to the RentalTrucks tab", len(rows) > 0)
    smith = [r for r in rows if "Smith LD" in str(r) and "Jones LD" in str(r)]
    check("the Sheet row lists both jobs a truck served", len(smith) > 0)
    from app.integrations.sheet_backfill import BACKFILL_REGISTRY
    check("the backfill registry covers the tab", any(e["key"] == "rental_trucks" for e in BACKFILL_REGISTRY))
    check("the health check covers the tab", any(e["key"] == "rental_trucks" for e in sx.SHEET_SYNC_REGISTRY))


if __name__ == "__main__":
    print("Verifying: rental truck records (ADR 0055)\n")
    for title, fn in (
        (" Entered at the DVIR", entered_at_dvir),
        (" Reused on a second job", reused_on_second_job),
        (" The job header", job_header),
        (" Plate lock", plate_lock),
        (" Leaving the list", leaving_the_list),
        (" Owned trucks", owned_untouched),
        (" The office's copy", sheet_rows),
    ):
        print(title)
        fn()
    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + ", ".join(FAILS))
        sys.exit(1)
    print("All checks passed.")
