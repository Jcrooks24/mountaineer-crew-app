"""Verify a rental DVIR names the actual truck, and does not share a history.

    python backend/scripts/verify_rental_truck_identity.py

Needs no Postgres and no network. The registry read and the prior-report query
are both driven through small fakes.

WHAT IT GUARDS. A fleet-registry entry named "rental" is a PLACEHOLDER reused
across every truck the company ever hires, and that is current practice, not a
hypothetical. Before ADR 0053 that meant two separate failures:

  1. The DVIR, the RODS and the BOL all recorded the vehicle as the string
     "rental". Nothing anywhere said which physical truck a record described,
     and nothing recorded the GVWR that decides whether federal rules reached
     the trip at all.

  2. Every rental shared ONE inspection history, because the 396.13 prior-report
     review and the out-of-service lockout both key on the unit name. An
     unresolved defect on a truck handed back weeks ago would refuse to let a
     driver inspect an unrelated truck, naming a defect that truck never had.
     In the other direction, a clean report on the old truck cleared a
     defective one.

THE REGRESSIONS TO FEAR are subtle and both silent:

  - dropping `vehicle_identifier` from the prior-report query, which looks like
    a redundant filter and silently re-merges every rental into one history
  - letting a rental DVIR through without a plate, which produces a report that
    does not identify the vehicle and cannot be scoped afterwards

Owned units must keep working exactly as before: for those the name IS the
truck, no identifier is passed, and nothing about the query changed.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone as _tz

_T0 = datetime(2026, 9, 17, tzinfo=_tz.utc)

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


# ── Fakes ────────────────────────────────────────────────────────────────────

class ConfigRow:
    def __init__(self, value):
        self.value = value


class FakeQuery:
    """Records the filters applied so a dropped scoping filter is detectable,
    and applies them so a wrong filter fails too."""

    def __init__(self, rows, kind):
        self.rows, self.kind = rows, kind
        self.filtered_on = []

    def filter(self, *criteria):
        for c in criteria:
            col = getattr(getattr(c, "left", None), "key", None) or str(c)
            self.filtered_on.append(col)
            want = getattr(getattr(c, "right", None), "value", None)
            if col in ("vehicle_number", "vehicle_identifier"):
                self.rows = [r for r in self.rows if getattr(r, col, None) == want]
        return self

    def order_by(self, *a):
        return self

    def first(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, units_json, dvirs=()):
        self.units_json = units_json
        self.dvirs = list(dvirs)
        self.last_query = None

    def query(self, model):
        name = getattr(model, "__name__", str(model))
        if name == "SystemConfig":
            q = FakeQuery([ConfigRow(self.units_json)], "config")
            q.filter = lambda *a: q          # config lookup filters by key
            q.first = lambda: ConfigRow(self.units_json) if self.units_json else None
            return q
        q = FakeQuery(self.dvirs, "dvir")
        self.last_query = q
        return q


class Dvir:
    """A DVIR row with just enough on it for _to_response to serialize.

    Only the three fields the scoping actually turns on are meaningful; the rest
    exist so the response mapper does not fall over. `__getattr__` answers None
    for anything else, so this fake does not need updating every time the real
    model grows a column.
    """

    def __init__(self, vehicle_number, vehicle_identifier=None, dvir_id="d1"):
        self.vehicle_number = vehicle_number
        self.vehicle_identifier = vehicle_identifier
        self.dvir_id = dvir_id
        self.id = 1
        self.condition = "satisfactory"
        self.defects_json = None
        self.inspection_type = "pre-trip"
        self.inspection_date = "2026-09-17"
        self.driver_name = "Pat Lee"
        self.driver_signature = "data:image/png;base64,x"
        self.driver_signed_at = _T0
        self.created_at = _T0

    def __getattr__(self, name):
        return None


UNITS = (
    '[{"name": "RENTAL", "is_rental": true},'
    ' {"name": "26INT", "is_rental": false}]'
)


# ── The registry flag ────────────────────────────────────────────────────────

def registry_flag():
    from app.core.vehicle_units import normalize_units
    import json
    units = normalize_units(json.loads(UNITS))
    by = {u["name"]: u for u in units}
    check("a rental entry keeps its flag through normalize", by["RENTAL"]["is_rental"] is True)
    check("an owned entry is not a rental", by["26INT"]["is_rental"] is False)

    # An entry saved before this field existed must not become a rental.
    legacy = normalize_units([{"name": "24FR8"}])
    check("a legacy entry defaults to not-a-rental", legacy[0]["is_rental"] is False)

    from app.routers.dvir import _is_rental_unit
    db = FakeDB(UNITS)
    check("_is_rental_unit finds the rental", _is_rental_unit(db, "RENTAL") is True)
    check("_is_rental_unit is case-insensitive", _is_rental_unit(db, "rental") is True)
    check("_is_rental_unit says no for an owned unit", _is_rental_unit(db, "26INT") is False)
    check("an unknown unit is NOT treated as a rental",
          _is_rental_unit(db, "SOMETHING-ELSE") is False,
          "refusing to inspect an unregistered truck would be worse")
    check("no registry configured means no rental", _is_rental_unit(FakeDB(None), "RENTAL") is False)


# ── The submit guard ─────────────────────────────────────────────────────────

def submit_guard():
    from fastapi import HTTPException
    from app.routers.dvir import create_dvir
    from app.schemas.dvir import DVIRCreate
    from datetime import datetime, timezone

    def body(unit, ident):
        return DVIRCreate(
            dvir_id="d-new", vehicle_number=unit, vehicle_identifier=ident,
            inspection_type="pre-trip", inspection_date="2026-09-17",
            driver_name="Pat Lee", driver_signature="data:image/png;base64,x",
            driver_signed_at=datetime.now(timezone.utc),
        )

    db = FakeDB(UNITS, dvirs=[])
    for label, ident in (("no plate", None), ("blank plate", ""), ("whitespace", "  ")):
        try:
            create_dvir(body("RENTAL", ident), db=db, current_user=None)
            check(f"rental DVIR refused without a plate ({label})", False, "it was accepted")
        except HTTPException as exc:
            check(f"rental DVIR refused without a plate ({label})", exc.status_code == 400,
                  f"status {exc.status_code}")
        except Exception as exc:
            check(f"rental DVIR refused without a plate ({label})", False,
                  f"{type(exc).__name__}: {exc}")

    # An OWNED unit must not be asked for a plate. It will fail later on the
    # fake db, which proves it passed the guard.
    try:
        create_dvir(body("26INT", None), db=FakeDB(UNITS, dvirs=[]), current_user=None)
        owned_ok = True
    except HTTPException:
        owned_ok = False
    except Exception:
        owned_ok = True
    check("an owned unit still needs no plate", owned_ok)


# ── The prior-report scoping ─────────────────────────────────────────────────

def prior_report_scoping():
    from app.routers.dvir import latest_for_vehicle

    old = Dvir("RENTAL", "MT-OLD-111", "returned-truck")
    new = Dvir("RENTAL", "MT-NEW-222", "current-truck")

    db = FakeDB(UNITS, dvirs=[old, new])
    got = latest_for_vehicle("RENTAL", vehicle_identifier="MT-NEW-222", db=db, _=None)
    check("a rental's review finds ITS OWN last report",
          got is not None and got.dvir_id == "current-truck",
          f"got {getattr(got, 'dvir_id', None)}")
    check("the query is scoped by vehicle_identifier",
          "vehicle_identifier" in (db.last_query.filtered_on if db.last_query else []),
          "dropping this filter re-merges every rental into one history")

    db2 = FakeDB(UNITS, dvirs=[old])
    got2 = latest_for_vehicle("RENTAL", vehicle_identifier="MT-NEW-222", db=db2, _=None)
    check("a different rental's defect does not reach this truck", got2 is None,
          "this is the lockout cross-contamination")

    db3 = FakeDB(UNITS, dvirs=[old, new])
    got3 = latest_for_vehicle("RENTAL", vehicle_identifier=None, db=db3, _=None)
    check("a rental with no plate gets no prior report at all", got3 is None,
          "answering with some other rental's report is the bug")

    owned_a = Dvir("26INT", None, "owned-report")
    db4 = FakeDB(UNITS, dvirs=[owned_a])
    got4 = latest_for_vehicle("26INT", vehicle_identifier=None, db=db4, _=None)
    check("an owned unit still gets its last report with no identifier",
          got4 is not None and got4.dvir_id == "owned-report",
          f"got {getattr(got4, 'dvir_id', None)}")


# ── The record carries the identity to the office ────────────────────────────

def sheet_columns():
    from app.integrations.sheets_export import DVIR_HEADERS, _dvir_row
    for col in ("vehicle_identifier", "rental_company", "rental_agreement", "gvwr_lbs"):
        check(f"the DVIRs worksheet has a {col} column", col in DVIR_HEADERS)

    row = _dvir_row({
        "dvir_id": "d1", "vehicle_number": "RENTAL", "vehicle_identifier": "MT-NEW-222",
        "rental_company": "Penske", "rental_agreement": "AG-9", "gvwr_lbs": 25999,
    }, "driver")
    check("the plate reaches the Sheet row", row["vehicle_identifier"] == "MT-NEW-222")
    check("the GVWR reaches the Sheet row", row["gvwr_lbs"] == 25999)
    blank = _dvir_row({"dvir_id": "d2", "vehicle_number": "26INT"}, "driver")
    check("an owned unit's row leaves the rental columns empty",
          blank["vehicle_identifier"] == "" and blank["gvwr_lbs"] == "")


if __name__ == "__main__":
    print("Verifying: a rental DVIR names the actual truck\n")
    print(" The registry flag")
    registry_flag()
    print(" The submit guard")
    submit_guard()
    print(" Prior-report scoping (396.13 review + out-of-service lockout)")
    prior_report_scoping()
    print(" The identity reaches the office")
    sheet_columns()

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + ", ".join(FAILS))
        sys.exit(1)
    print("All checks passed.")
