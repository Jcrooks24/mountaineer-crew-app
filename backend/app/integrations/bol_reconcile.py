"""
Reconciliation between the digital_bols table and the BOLs / BOLItems sheet tabs.

A BOL is written to Postgres synchronously, then its Sheets export is scheduled
onto the bounded background pool (schedule_bol_export). That pool thread can die
before it runs - Render recycles workers every `--limit-max-requests`, plus the
OOM-kill history - leaving the BOL committed in `digital_bols` but never written
to the sheet, with nothing to retry. For a signed legal document, that is the
worst failure mode: the record simply is not where the office looks for it.

This module finds those orphans (BOLs with no `sheet_generic_exports` entry) and
ships them through the existing exporter, which is idempotent via that same
dedupe table. It mirrors sheets_reconcile.py (events) deliberately - same shape,
same advisory-locked auto-reconciler, so there is one durability pattern to
understand, not two. See ADR 0020.

Used by:
- the background auto-reconciler (auto_reconciler.py), every cycle
- POST /api/admin/sheets/reconcile-bols        (admin-triggered)
- POST /api/admin/bol/{bol_id}/reexport        (force one document, dev/recovery)
"""

from __future__ import annotations

import time as _time
from typing import Any, Dict

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.integrations.sheets_export import _build_bol_payload, export_bol_to_sheets


# A BOL is "unexported" when NO row in sheet_generic_exports (kind='bol') carries
# its bol_id prefix - i.e. it was never successfully exported. NOT EXISTS lets the
# planner use the dedupe index; ORDER BY id ASC makes consecutive runs progress.
_UNEXPORTED_QUERY = text(
    "SELECT b.id, b.bol_id FROM digital_bols b "
    "WHERE b.id > :after AND NOT EXISTS ("
    "    SELECT 1 FROM sheet_generic_exports s "
    "    WHERE s.kind = 'bol' AND s.export_key LIKE b.bol_id || ':%'"
    ") "
    "ORDER BY b.id ASC "
    "LIMIT :limit"
)

_COUNT_QUERY = text(
    "SELECT COUNT(*) FROM digital_bols b "
    "WHERE NOT EXISTS ("
    "    SELECT 1 FROM sheet_generic_exports s "
    "    WHERE s.kind = 'bol' AND s.export_key LIKE b.bol_id || ':%'"
    ")"
)


def count_unexported_bols(db: Session) -> int:
    """Cheap count of BOLs present in Postgres but missing from the sheet. For
    the App Health check so admin can see drift without a full reconcile."""
    row = db.execute(_COUNT_QUERY).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def reconcile_bols(
    db: Session,
    *,
    batch_size: int = 50,
    max_bols: int = 500,
    sleep_between_batches_s: float = 0.5,
) -> Dict[str, int]:
    """Find BOLs missing from the sheet and export them, in bounded batches.

    Each BOL is re-read from the DB (`_build_bol_payload`) and shipped through
    `export_bol_to_sheets`, which is idempotent and self-skips an already-current
    state. A BOL that fails is recorded in `seen` so it is not re-attempted within
    the same run (the next cycle picks it up); without that, a persistently
    failing BOL would be re-selected by the query every iteration. Never raises;
    the caller can surface `errors > 0`."""
    found = 0
    exported = 0
    errors = 0
    # Keyset cursor by primary-key id. A BOL that FAILS to export keeps no dedupe
    # row, so a plain LIMIT query would re-select the same low-id failures every
    # batch and starve healthy higher-id BOLs. Advancing `after` past every row we
    # look at (success OR failure) guarantees the run sweeps forward exactly once;
    # a failed BOL is retried on the NEXT cycle (which starts at after=0), not
    # spun on within this one.
    after = 0
    started = _time.monotonic()

    while exported + errors < max_bols:
        remaining = max_bols - exported - errors
        take = min(batch_size, remaining)
        rows = db.execute(_UNEXPORTED_QUERY, {"limit": take, "after": after}).fetchall()
        if not rows:
            break
        found += len(rows)

        for row_id, bol_id in rows:
            after = max(after, row_id)  # advance the cursor regardless of outcome
            if not bol_id:
                continue
            try:
                payload = _build_bol_payload(db, bol_id)
                if payload is None:
                    # Row vanished between the query and now - nothing to export.
                    exported += 1
                    continue
                export_bol_to_sheets(db, payload)
                exported += 1
            except Exception as exc:
                try:
                    db.rollback()
                except Exception:
                    pass
                print(f"[bol-reconcile] export failed ({bol_id}): {exc}")
                errors += 1

        if sleep_between_batches_s > 0 and exported + errors < max_bols:
            _time.sleep(sleep_between_batches_s)

    return {
        "found": found,
        "exported": exported,
        "errors": errors,
        "duration_ms": int((_time.monotonic() - started) * 1000),
    }


def force_reexport_bol(db: Session, bol_id: str) -> Dict[str, Any]:
    """Force a fresh export of ONE BOL by id, even if it is already exported or
    its sheet row is stale/blank. Clears the dedupe entries for this bol_id so the
    exporter's idempotency skip does not short-circuit, then re-exports the
    current DB state. This is the only way to force a BOL re-write on demand;
    there was previously no such path (you had to trigger a real save)."""
    db.execute(
        text(
            "DELETE FROM sheet_generic_exports "
            "WHERE kind IN ('bol', 'bol_item') AND export_key LIKE :prefix"
        ),
        {"prefix": f"{bol_id}:%"},
    )
    db.commit()

    payload = _build_bol_payload(db, bol_id)
    if payload is None:
        return {"ok": False, "error": "BOL not found in the database."}
    written = export_bol_to_sheets(db, payload)
    return {"ok": True, "bol_id": bol_id, "rows_written": written}
