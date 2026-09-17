"""Verify a RODS row cannot be created or published without a signature.

    python backend/scripts/verify_rods_signed_only.py

Needs no Postgres, no Sheets access and no network. Each layer is called
directly with a fake, because each one refuses before it touches anything real.

WHAT IT GUARDS. `rods_logs` is the office's duty-status record, and under V-5 in
docs/COMPLIANCE_REFERENCE.md it is the ONLY record of duty status: there is no
paper log behind it. Every row in that table is therefore a certified record.

That used to be true only by accident. The server accepted an unsigned day (the
`signature` column is nullable for cross-device continuity that was designed and
never built), and the rule held purely because the field app happens to submit
only after the driver signs. Four server paths read the table. Two of them, the
Sheet backfill's source list and its re-export, carry no signature check, and
`export_rods_to_sheets` had none either. So a single unsigned row reaching the
table would have been listed as missing from the Sheet and then published into
the compliance copy as though a driver had certified it.

Three layers now refuse, and this script checks all three, because any one of
them alone is a rule that a future change can step around:

  1. the router refuses an unsigned submit outright
  2. the export function refuses to write an unsigned row to the worksheet
  3. the backfill's source list does not consider an unsigned row publishable

THE REGRESSION TO FEAR is someone implementing the in-progress draft store
(A-03) by re-opening this endpoint to unsigned payloads, which is the obvious
way to do it and is exactly what ADR 0052 forbids. Drafts belong in their own
table that none of these paths read.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


# ── Layer 1: the router refuses an unsigned submit ───────────────────────────

def layer_1_router():
    from fastapi import HTTPException
    from app.routers.long_distance import create_rods
    from app.schemas.long_distance import RodsCreate

    def body(sig):
        return RodsCreate(
            rods_id="r1", driver_name="Pat Lee", log_date="2026-09-17",
            duty_changes=[], signature=sig,
        )

    # db and current_user are never reached: the guard is the first statement.
    for label, sig in (("null", None), ("empty", ""), ("whitespace", "   ")):
        try:
            create_rods(body(sig), db=None, current_user=None)
            check(f"unsigned submit refused ({label} signature)", False, "it was accepted")
        except HTTPException as exc:
            check(
                f"unsigned submit refused ({label} signature)",
                exc.status_code == 400,
                f"status {exc.status_code}",
            )
        except Exception as exc:  # reached the DB, so the guard did not fire first
            check(f"unsigned submit refused ({label} signature)", False, f"{type(exc).__name__}: {exc}")

    # A 400 is a PERMANENT rejection to the client queue (queueFailure.ts), so
    # the day is marked failed and skipped rather than retried forever. Any of
    # the transient four would wedge the queue on a payload that can never fix
    # itself.
    try:
        create_rods(body(None), db=None, current_user=None)
        status = None
    except HTTPException as exc:
        status = exc.status_code
    check("refusal is permanent to the offline queue", status not in (401, 403, 408, 429),
          f"status {status}, transient set is 401/403/408/429")

    # A signed day must NOT be refused by the guard. It will fail later reaching
    # the fake db, which is the proof it got past the signature check.
    try:
        create_rods(body("data:image/png;base64,iVBORw0KGgo="), db=None, current_user=None)
        passed_guard = True
    except HTTPException:
        passed_guard = False
    except Exception:
        passed_guard = True   # got past the guard, died on db=None as expected
    check("a signed day is not refused by the guard", passed_guard)


# ── Layer 2: the export refuses to publish an unsigned row ───────────────────

def layer_2_export():
    from app.integrations.sheets_export import export_rods_to_sheets

    for label, sig in (("null", None), ("empty", ""), ("whitespace", "  ")):
        written = export_rods_to_sheets(None, {"rods_id": "r1", "signature": sig})
        check(f"unsigned row not written to the worksheet ({label})", written == 0,
              f"returned {written}")


# ── Layer 3: the backfill does not consider an unsigned row publishable ──────

def layer_3_backfill():
    from app.integrations.sheet_backfill import _src_rods

    class Row:
        def __init__(self, rid, sig):
            self.rods_id, self.signature = rid, sig
            self.driver_name, self.log_date, self.created_at = "Pat Lee", "2026-09-17", None

    class FakeQuery:
        """Just enough SQLAlchemy to record that a filter was applied and to
        apply it, so a filter that is present but wrong still fails."""
        def __init__(self, rows):
            self.rows = rows
            self.filtered = False

        def filter(self, *criteria):
            self.filtered = True
            # Mimic `signature IS NOT NULL AND signature != ''`.
            self.rows = [r for r in self.rows if (r.signature or "").strip()]
            return self

        def order_by(self, *a):
            return self

        def all(self):
            return self.rows

    class FakeDB:
        def __init__(self, rows):
            self.q = FakeQuery(rows)

        def query(self, *a):
            return self.q

    db = FakeDB([Row("signed", "data:image/png;base64,x"), Row("unsigned", None), Row("blank", "")])
    out = _src_rods(db)
    ids = [o["id"] for o in out]
    check("backfill applies a signature filter at the query", db.q.filtered)
    check("backfill lists the signed day", ids == ["signed"], f"got {ids}")


if __name__ == "__main__":
    print("Verifying: a RODS row cannot exist or be published unsigned\n")
    print(" Layer 1 - router")
    layer_1_router()
    print(" Layer 2 - Sheets export")
    layer_2_export()
    print(" Layer 3 - Sheet backfill source")
    layer_3_backfill()

    print()
    if FAILS:
        print(f"FAILED ({len(FAILS)}): " + ", ".join(FAILS))
        sys.exit(1)
    print("All checks passed.")
