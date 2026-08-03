"""Audit and backfill: which records exist in Postgres but never reached the Sheet.

Postgres is the system of record and the Sheet is a mirror, so a failed export is
never data loss - but it is a hole in the mirror that nothing closes. Only two
syncs self-heal: events and BOLs, via `auto_reconciler`. Every other export fires
once at write time, and if it dies (quota 429, SSL drop, worker recycled
mid-flight) the row is stranded until a human happens to re-save that record.
`sheet_sync_status` cannot tell you which ones - it stores one row per export
*function*, so a later success for some other record overwrites the evidence.

This module answers the question directly by comparing the two sides:

  audit_sheet_backfill(db)  -> per sync, the records in Postgres whose key does
                               not appear in the sheet tab
  reexport_missing(db, ...) -> re-drive the real export for those records

**The sheet is the ground truth here, not the `sheet_generic_exports` marker
table.** A marker records that we *believed* we wrote a row; if the write died
after the marker (or a row was later deleted by hand in the sheet), the marker
lies and the audit would report a clean bill of health. Reading the key column
back costs one API call and cannot be wrong.

Read cost is deliberately flat: three Sheets calls for the whole audit
regardless of how many syncs are registered (one metadata read, one batched
header read, one batched key-column read). A naive per-tab loop would be ~40
reads and would trip the 60/min quota that caused the failures being audited.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.integrations.sheets_export import (
    DEFAULT_SHEET_ID,
    _api,
    _col_letter,
    _get_sheets_svc,
    _sheet_ids,
)

# A single re-export request queues at most this many records. The export pool
# has two workers; a 500-item flood would starve live crew syncs behind the
# backfill and re-create the quota problem this exists to clean up after.
MAX_REEXPORT_PER_REQUEST = 100

# How many missing records to name in the audit response. The count is always
# exact; only the listing is truncated, so the UI stays readable.
MAX_LISTED_PER_KIND = 100


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


# ─────────────────────────────────────────────────────────────────────────────
# Source queries: what Postgres thinks should be in each tab.
#
# Each returns a list of {id, label, created_at, ref}. `id` must equal the value
# the export writes into the tab's key column - that equality is the whole audit.
# `ref` is whatever the re-export needs to rebuild the record (defaults to `id`).
# ─────────────────────────────────────────────────────────────────────────────

def _src_materials(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.materials import MaterialsSubmission
    rows = db.query(MaterialsSubmission).order_by(MaterialsSubmission.created_at.desc()).all()
    return [{
        "id": r.submission_id,
        "label": f"{r.job_name or r.job_label or r.job_uuid} - {r.job_date or ''}".strip(" -"),
        "created_at": _iso(r.created_at),
    } for r in rows if r.submission_id]


def _src_job_reports(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.job_report import JobReport
    rows = db.query(JobReport).order_by(JobReport.updated_at.desc()).all()
    return [{
        "id": r.job_uuid,
        "label": f"report by {r.submitted_by_name or 'unknown'}",
        "created_at": _iso(r.created_at),
    } for r in rows if r.job_uuid]


def _src_bills(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.job_bill import JobBill
    rows = db.query(JobBill).order_by(JobBill.updated_at.desc()).all()
    return [{
        "id": r.job_uuid,
        "label": f"bill saved by {r.saved_by_name or 'unknown'}",
        "created_at": _iso(r.created_at),
    } for r in rows if r.job_uuid]


def _src_estimates(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.estimate import Estimate
    rows = db.query(Estimate).order_by(Estimate.updated_at.desc()).all()
    return [{
        "id": r.estimate_uuid,
        "label": f"{r.customer_name or 'no name'} ({r.move_date or 'TBD'})",
        "created_at": _iso(r.created_at),
    } for r in rows if r.estimate_uuid]


def _src_estimate_items(db: Session) -> List[Dict[str, Any]]:
    """Estimates that HAVE items. The items tab is keyed by estimate_uuid, so an
    estimate with rows in Estimates but none in EstimateItems is the exact
    summary-landed-items-didn't failure the retry hotfix was written for."""
    from app.db.models.estimate import Estimate, EstimateItem
    counts = dict(
        db.query(EstimateItem.estimate_id, func.count(EstimateItem.id))
        .group_by(EstimateItem.estimate_id)
        .all()
    )
    rows = db.query(Estimate).order_by(Estimate.updated_at.desc()).all()
    return [{
        "id": r.estimate_uuid,
        "label": f"{r.customer_name or 'no name'} - {counts.get(r.id, 0)} item(s)",
        "created_at": _iso(r.created_at),
    } for r in rows if r.estimate_uuid and counts.get(r.id, 0) > 0]


def _src_job_inventory(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.job_inventory import JobInventoryItem
    rows = (
        db.query(
            JobInventoryItem.job_uuid,
            func.count(JobInventoryItem.id),
            func.min(JobInventoryItem.created_at),
        )
        .group_by(JobInventoryItem.job_uuid)
        .all()
    )
    return [{
        "id": job_uuid,
        "label": f"{count} item(s) logged",
        "created_at": _iso(first_at),
    } for job_uuid, count, first_at in rows if job_uuid]


def _src_incidents(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.incident import Incident
    rows = db.query(Incident).order_by(Incident.updated_at.desc()).all()
    return [{
        "id": r.incident_uuid,
        "label": f"{r.severity or ''} - {r.job_name or r.job_uuid or 'no job'}".strip(" -"),
        "created_at": _iso(r.created_at),
    } for r in rows if r.incident_uuid]


def _src_dvirs(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.dvir import DVIR
    rows = db.query(DVIR).order_by(DVIR.created_at.desc()).all()
    return [{
        "id": r.dvir_id,
        "label": f"{r.inspection_type} {r.vehicle_number} ({r.inspection_date})",
        "created_at": _iso(r.created_at),
    } for r in rows if r.dvir_id]


def _src_prior_hours(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.long_distance import PriorOnDutyStatement
    rows = db.query(PriorOnDutyStatement).order_by(PriorOnDutyStatement.created_at.desc()).all()
    return [{
        "id": r.statement_id,
        "label": f"{r.driver_name} ({r.statement_date})",
        "created_at": _iso(r.created_at),
    } for r in rows if r.statement_id]


def _src_rods(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.long_distance import RodsLog
    rows = db.query(RodsLog).order_by(RodsLog.created_at.desc()).all()
    return [{
        "id": r.rods_id,
        "label": f"{r.driver_name} ({r.log_date})",
        "created_at": _iso(r.created_at),
    } for r in rows if r.rods_id]


def _src_ld_pay(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.long_distance import LdDay
    rows = db.query(LdDay).order_by(LdDay.date.desc()).all()
    return [{
        "id": r.day_id,
        "label": f"{r.driver_name} ({r.date})",
        "created_at": _iso(getattr(r, "created_at", None)),
    } for r in rows if r.day_id]


def _src_office_hours(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.office_hours import OfficeHoursEntry
    rows = db.query(OfficeHoursEntry).order_by(OfficeHoursEntry.updated_at.desc()).all()
    return [{
        "id": r.entry_uuid,
        "label": f"{r.user_name} ({r.work_date})",
        "created_at": _iso(r.created_at),
    } for r in rows if r.entry_uuid]


def _src_reimbursements(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.reimbursement import Reimbursement
    rows = db.query(Reimbursement).order_by(Reimbursement.created_at.desc()).all()
    return [{
        "id": r.reimbursement_uuid,
        "label": f"{r.user_name} - {r.type} ({r.expense_date or ''})".strip(" ()"),
        "created_at": _iso(r.created_at),
    } for r in rows if r.reimbursement_uuid]


def _src_off_job(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.off_job_entry import OffJobEntry
    rows = db.query(OffJobEntry).order_by(OffJobEntry.updated_at.desc()).all()
    return [{
        "id": r.entry_uuid,
        "label": f"{r.submitted_by_name or 'unknown'} ({r.work_date or ''})".strip(" ()"),
        "created_at": _iso(r.created_at),
    } for r in rows if r.entry_uuid]


def _src_bug_reports(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.bug_report import BugReport
    rows = db.query(BugReport).order_by(BugReport.created_at.desc()).all()
    return [{
        "id": r.bug_uuid,
        "label": f"{r.submitted_by_name or 'unknown'} ({r.occurred_date or ''})".strip(" ()"),
        "created_at": _iso(r.created_at),
    } for r in rows if r.bug_uuid]


def _src_availability(db: Session) -> List[Dict[str, Any]]:
    """Keyed by (user_name, window_start) because that is what the tab holds -
    one row per person per 14-day window, not one per day."""
    from app.db.models.availability import AvailabilityDay
    rows = (
        db.query(
            AvailabilityDay.user_name,
            AvailabilityDay.window_start,
            func.min(AvailabilityDay.user_id),
            func.min(AvailabilityDay.created_at),
        )
        .group_by(AvailabilityDay.user_name, AvailabilityDay.window_start)
        .all()
    )
    return [{
        "id": f"{user_name}||{window_start}",
        "label": f"{user_name} - window starting {window_start}",
        "created_at": _iso(first_at),
        "ref": {"user_id": user_id, "window_start": window_start},
    } for user_name, window_start, user_id, first_at in rows if user_name and window_start]


# ─────────────────────────────────────────────────────────────────────────────
# Re-export drivers. Each re-drives the *real* export path for one record, so a
# backfilled row is byte-identical to one written at save time - no second
# code path to drift. Router helpers are imported inline: routers import
# sheets_export, so a module-level import here would be circular.
# ─────────────────────────────────────────────────────────────────────────────

def _re_materials(db: Session, ref: Any) -> None:
    from app.db.models.materials import MaterialsSubmission
    from app.integrations.sheets_export import (
        export_materials_to_sheets,
        rebuild_job_materials_total_in_bills,
        run_export_in_background,
    )
    row = db.query(MaterialsSubmission).filter(
        MaterialsSubmission.submission_id == ref
    ).first()
    if not row:
        return
    run_export_in_background(export_materials_to_sheets, {
        "id": row.submission_id,
        "created_at": row.created_at,
        "job_uuid": row.job_uuid,
        "jobName": row.job_name or "",
        "jobLabel": row.job_label or "",
        "jobDate": row.job_date or "",
        "notes": row.notes or "",
        "items": json.loads(row.items_json or "[]"),
        "total": row.total,
    })
    run_export_in_background(rebuild_job_materials_total_in_bills, row.job_uuid)


def _re_job_report(db: Session, ref: Any) -> None:
    from app.db.models.job_report import JobReport
    from app.routers.job_report import _export_report_to_sheets
    row = db.query(JobReport).filter(JobReport.job_uuid == ref).first()
    if row:
        _export_report_to_sheets(db, row)


def _re_bill(db: Session, ref: Any) -> None:
    from app.db.models.job_bill import JobBill
    from app.routers.bill import _export_bill
    row = db.query(JobBill).filter(JobBill.job_uuid == ref).first()
    if row:
        _export_bill(db, row)


def _re_estimate(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_estimate_export
    schedule_estimate_export(str(ref))


def _re_job_inventory(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_job_inventory_export
    schedule_job_inventory_export(str(ref))


def _re_incident(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_incident_export
    schedule_incident_export(str(ref))


def _re_dvir(db: Session, ref: Any) -> None:
    from app.db.models.dvir import DVIR
    from app.integrations.sheets_export import export_dvir_to_sheets, run_export_in_background
    from app.routers.dvir import _to_response
    row = db.query(DVIR).filter(DVIR.dvir_id == ref).first()
    if not row:
        return
    payload = _to_response(row).model_dump()
    run_export_in_background(export_dvir_to_sheets, payload, phase="driver")
    # The mechanic row only exists once a mechanic has signed; re-drive it too so
    # a backfilled DVIR carries the same two rows a live one would.
    if row.mechanic_signed_at:
        run_export_in_background(export_dvir_to_sheets, payload, phase="mechanic")


def _re_prior_hours(db: Session, ref: Any) -> None:
    from app.db.models.long_distance import PriorOnDutyStatement
    from app.integrations.sheets_export import export_prior_hours_to_sheets, run_export_in_background
    from app.routers.long_distance import _to_response
    row = db.query(PriorOnDutyStatement).filter(
        PriorOnDutyStatement.statement_id == ref
    ).first()
    if row:
        run_export_in_background(export_prior_hours_to_sheets, _to_response(row).model_dump())


def _re_rods(db: Session, ref: Any) -> None:
    from app.db.models.long_distance import RodsLog
    from app.integrations.sheets_export import export_rods_to_sheets, run_export_in_background
    from app.routers.long_distance import _rods_to_response
    row = db.query(RodsLog).filter(RodsLog.rods_id == ref).first()
    if row:
        run_export_in_background(export_rods_to_sheets, _rods_to_response(row).model_dump())


def _re_ld_pay(db: Session, ref: Any) -> None:
    from app.db.models.long_distance import LdDay
    from app.integrations.sheets_export import export_ld_day_to_sheets, run_export_in_background
    from app.routers.long_distance import _ld_to_dict
    row = db.query(LdDay).filter(LdDay.day_id == ref).first()
    if row:
        run_export_in_background(export_ld_day_to_sheets, _ld_to_dict(row))


def _re_office_hours(db: Session, ref: Any) -> None:
    from app.db.models.office_hours import OfficeHoursEntry
    from app.routers.office_hours import _queue_export
    row = db.query(OfficeHoursEntry).filter(OfficeHoursEntry.entry_uuid == ref).first()
    if row:
        _queue_export(row)


def _re_reimbursement(db: Session, ref: Any) -> None:
    from app.db.models.reimbursement import Reimbursement
    from app.routers.reimbursement import _queue_export
    row = db.query(Reimbursement).filter(Reimbursement.reimbursement_uuid == ref).first()
    if row:
        _queue_export(row)


def _re_off_job(db: Session, ref: Any) -> None:
    from app.db.models.off_job_entry import OffJobEntry
    from app.routers.off_job import _export
    row = db.query(OffJobEntry).filter(OffJobEntry.entry_uuid == ref).first()
    if row:
        _export(row)


def _re_bug_report(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_bug_report_export
    schedule_bug_report_export(str(ref))


def _re_availability(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_availability_export
    if isinstance(ref, dict) and ref.get("user_id") is not None:
        schedule_availability_export(int(ref["user_id"]), str(ref.get("window_start") or ""))


# ─────────────────────────────────────────────────────────────────────────────
# Registry. `key` matches SHEET_SYNC_REGISTRY so the two panels line up.
# `auto` marks the syncs auto_reconciler already backfills - listed so the panel
# accounts for all 19, but not diffed (scanning every event is expensive and the
# reconciler already owns that job).
# ─────────────────────────────────────────────────────────────────────────────

BACKFILL_REGISTRY: List[Dict[str, Any]] = [
    {"key": "events", "label": "Timeline events", "env": "SHEETS_EVENTS_TAB",
     "default": "Events", "auto": "auto-reconciler backfills events every 5 minutes"},
    {"key": "bols", "label": "Bills of lading", "env": "SHEETS_BOLS_TAB",
     "default": "BOLs", "auto": "auto-reconciler backfills BOLs every 5 minutes"},
    {"key": "bol_items", "label": "BOL items", "env": "SHEETS_BOL_ITEMS_TAB",
     "default": "BOLItems", "auto": "written by the same export as the BOL summary"},

    {"key": "materials", "label": "Materials", "env": "SHEETS_MATERIALS_TAB",
     "default": "Materials", "key_cols": ["submission_id"],
     "source": _src_materials, "reexport": _re_materials},
    {"key": "job_reports", "label": "Job reports", "env": "SHEETS_JOB_REPORTS_TAB",
     "default": "JobReports", "key_cols": ["job_uuid"],
     "source": _src_job_reports, "reexport": _re_job_report},
    {"key": "bills", "label": "Bills / invoices", "env": "SHEETS_BILLS_TAB",
     "default": "Bills", "key_cols": ["job_uuid"],
     "source": _src_bills, "reexport": _re_bill},
    {"key": "estimates", "label": "Estimates", "env": "SHEETS_ESTIMATES_TAB",
     "default": "Estimates", "key_cols": ["estimate_uuid"],
     "source": _src_estimates, "reexport": _re_estimate},
    {"key": "estimate_items", "label": "Estimate items", "env": "SHEETS_ESTIMATE_ITEMS_TAB",
     "default": "EstimateItems", "key_cols": ["estimate_uuid"],
     "source": _src_estimate_items, "reexport": _re_estimate},
    {"key": "job_inventory", "label": "Job inventory", "env": "SHEETS_JOB_INVENTORY_TAB",
     "default": "JobInventory", "key_cols": ["job_uuid"],
     "source": _src_job_inventory, "reexport": _re_job_inventory},
    {"key": "job_inventory_items", "label": "Job inventory items",
     "env": "SHEETS_JOB_INVENTORY_ITEMS_TAB", "default": "JobInventoryItems",
     "key_cols": ["job_uuid"], "source": _src_job_inventory, "reexport": _re_job_inventory},
    {"key": "incidents", "label": "Incidents", "env": "SHEETS_INCIDENTS_TAB",
     "default": "Incidents", "key_cols": ["incident_uuid"],
     "source": _src_incidents, "reexport": _re_incident},
    {"key": "dvirs", "label": "DVIRs", "env": "SHEETS_DVIRS_TAB",
     "default": "DVIRs", "key_cols": ["dvir_id"],
     "source": _src_dvirs, "reexport": _re_dvir},
    {"key": "prior_hours", "label": "Prior on-duty (PODS)", "env": "SHEETS_PRIOR_HOURS_TAB",
     "default": "PriorOnDuty", "key_cols": ["statement_id"],
     "source": _src_prior_hours, "reexport": _re_prior_hours},
    {"key": "rods", "label": "RODS logs", "env": "SHEETS_RODS_TAB",
     "default": "RODS", "key_cols": ["rods_id"],
     "source": _src_rods, "reexport": _re_rods},
    {"key": "ld_pay", "label": "Long-distance pay", "env": "SHEETS_LD_PAY_TAB",
     "default": "LongDistancePay", "key_cols": ["day_id"],
     "source": _src_ld_pay, "reexport": _re_ld_pay},
    {"key": "office_hours", "label": "Office hours", "env": "SHEETS_OFFICE_HOURS_TAB",
     "default": "OfficeHours", "key_cols": ["entry_uuid"],
     "source": _src_office_hours, "reexport": _re_office_hours},
    {"key": "reimbursements", "label": "Reimbursements", "env": "SHEETS_REIMBURSEMENTS_TAB",
     "default": "Reimbursements", "key_cols": ["reimbursement_uuid"],
     "source": _src_reimbursements, "reexport": _re_reimbursement},
    {"key": "availability", "label": "Availability", "env": "SHEETS_AVAILABILITY_TAB",
     "default": "Availability", "key_cols": ["user_name", "window_start"],
     "source": _src_availability, "reexport": _re_availability},
    {"key": "off_job_hours", "label": "Off-job hours", "env": "SHEETS_OFF_JOB_TAB",
     "default": "OffJobHours", "key_cols": ["entry_uuid"],
     "source": _src_off_job, "reexport": _re_off_job},
    {"key": "bug_reports", "label": "Bug reports", "env": "SHEETS_BUGS_TAB",
     "default": "Bugs", "key_cols": ["bug_uuid"],
     "source": _src_bug_reports, "reexport": _re_bug_report},
]


def _entry_for(key: str) -> Optional[Dict[str, Any]]:
    return next((e for e in BACKFILL_REGISTRY if e["key"] == key), None)


def _tab_for(entry: Dict[str, Any]) -> str:
    raw = (os.getenv(entry["env"]) or "").strip()
    return raw or entry["default"]


def _batch_values(svc, sid: str, ranges: List[str], major: str) -> Dict[str, List[List[Any]]]:
    """One API call for many ranges. Returns {range_requested: values}."""
    if not ranges:
        return {}
    resp = _api(lambda: svc.spreadsheets().values().batchGet(
        spreadsheetId=sid, ranges=ranges, majorDimension=major,
    ).execute())
    out: Dict[str, List[List[Any]]] = {}
    for requested, value_range in zip(ranges, resp.get("valueRanges", [])):
        out[requested] = value_range.get("values", []) or []
    return out


def audit_sheet_backfill(db: Session) -> Dict[str, Any]:
    """Compare Postgres against the Sheet, per sync. Read-only: writes nothing
    to either side."""
    sid = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", DEFAULT_SHEET_ID).strip()
    result: Dict[str, Any] = {"spreadsheet_id": sid, "connected": False,
                              "error": None, "results": []}
    try:
        svc = _get_sheets_svc(db)
        titles = _sheet_ids(svc, sid, refresh=True)
        result["connected"] = True
    except Exception as e:  # noqa: BLE001 - surface to the admin
        result["error"] = str(e)
        return result

    # Per-sync last export error, so a record that will not drain shows WHY: the
    # usual cause is the export throwing on every attempt (a data quirk in that
    # row), not a lost write. Joined by the export fn name via SHEET_SYNC_REGISTRY,
    # which is keyed the same as this module's registry.
    sync_status: Dict[str, Dict[str, Any]] = {}
    try:
        from app.integrations.sheets_export import SHEET_SYNC_REGISTRY
        from app.db.models.sheet_sync_status import SheetSyncStatus
        statuses = {r.fn_name: r for r in db.query(SheetSyncStatus).all()}
        for reg in SHEET_SYNC_REGISTRY:
            st = statuses.get(reg.get("fn") or "")
            if not st:
                continue
            ok_at, err_at = st.last_ok_at, st.last_error_at
            sync_status[reg["key"]] = {
                "failing": bool(err_at) and (ok_at is None or err_at > ok_at),
                "last_error": st.last_error,
                "last_error_at": err_at.isoformat() if err_at else None,
            }
    except Exception:  # noqa: BLE001 - status is a nice-to-have, never fail the audit
        sync_status = {}

    auditable = [e for e in BACKFILL_REGISTRY if not e.get("auto")]

    # Pass 1: header rows, batched. Locate each key column by NAME rather than
    # assuming column A - _ensure_tab appends new columns on the right, so the
    # order is stable today, but "stable today" is not a thing to build on.
    tabs = {e["key"]: _tab_for(e) for e in auditable}
    present = [e for e in auditable if tabs[e["key"]] in titles]
    header_ranges = [f"'{tabs[e['key']]}'!1:1" for e in present]
    headers = _batch_values(svc, sid, header_ranges, "ROWS")

    # Pass 2: the key column span for each tab, batched.
    spans: Dict[str, Dict[str, Any]] = {}
    value_ranges: List[str] = []
    for entry, rng in zip(present, header_ranges):
        row = (headers.get(rng) or [[]])
        cols = row[0] if row else []
        try:
            idxs = [cols.index(name) for name in entry["key_cols"]]
        except ValueError:
            spans[entry["key"]] = {"error": (
                f"key column(s) {', '.join(entry['key_cols'])} not found in the "
                f"'{tabs[entry['key']]}' header row"
            )}
            continue
        lo, hi = min(idxs), max(idxs)
        vr = f"'{tabs[entry['key']]}'!{_col_letter(lo)}:{_col_letter(hi)}"
        spans[entry["key"]] = {"range": vr, "lo": lo, "idxs": idxs}
        value_ranges.append(vr)

    columns = _batch_values(svc, sid, value_ranges, "COLUMNS") if value_ranges else {}

    for entry in auditable:
        key = entry["key"]
        tab = tabs[key]
        st = sync_status.get(key) or {}
        row_out: Dict[str, Any] = {
            "key": key, "label": entry["label"], "tab": tab,
            "tab_exists": tab in titles, "auto": None, "error": None,
            # Drain diagnostics: if the last export attempt for this sync failed,
            # the same failure is why its missing records will not re-send. The UI
            # shows this next to the missing count instead of "re-send did nothing".
            "failing": st.get("failing", False),
            "last_error": st.get("last_error"),
            "last_error_at": st.get("last_error_at"),
        }
        try:
            records = entry["source"](db)
        except Exception as e:  # noqa: BLE001 - one bad kind must not kill the audit
            row_out["error"] = f"could not read from the database: {e}"
            row_out["in_db"] = 0
            row_out["missing"] = []
            row_out["missing_count"] = 0
            result["results"].append(row_out)
            continue

        row_out["in_db"] = len(records)
        span = spans.get(key) or {}
        if span.get("error"):
            row_out["error"] = span["error"]
            row_out["missing"] = []
            row_out["missing_count"] = 0
            result["results"].append(row_out)
            continue

        if tab not in titles:
            # No tab means nothing has ever landed - every record is missing.
            sheet_keys: set = set()
        else:
            cols = columns.get(span["range"], [])
            rel = [i - span["lo"] for i in span["idxs"]]
            sheet_keys = set()
            # A column-major read gives one list per column, each already
            # trimmed of trailing blanks - so index defensively.
            depth = max((len(c) for c in cols), default=0)
            for r in range(1, depth):  # skip the header row
                parts = []
                for j in rel:
                    col = cols[j] if j < len(cols) else []
                    parts.append(col[r] if r < len(col) else "")
                sheet_keys.add("||".join(str(p) for p in parts))

        missing = [r for r in records if r["id"] not in sheet_keys]
        row_out["in_sheet"] = len(sheet_keys)
        row_out["missing_count"] = len(missing)
        row_out["missing"] = [{
            "id": m["id"],
            "label": m.get("label") or "",
            "created_at": m.get("created_at") or "",
        } for m in missing[:MAX_LISTED_PER_KIND]]
        row_out["truncated"] = len(missing) > MAX_LISTED_PER_KIND
        result["results"].append(row_out)

    for entry in BACKFILL_REGISTRY:
        if entry.get("auto"):
            result["results"].append({
                "key": entry["key"], "label": entry["label"],
                "tab": _tab_for(entry), "tab_exists": _tab_for(entry) in titles,
                "auto": entry["auto"], "in_db": None, "in_sheet": None,
                "missing": [], "missing_count": 0, "error": None,
            })

    result["total_missing"] = sum(r["missing_count"] for r in result["results"])
    return result


# Total records re-driven across ALL syncs in one auto-reconcile cycle.
# Deliberately well under the manual tool's per-sync cap: this runs unattended on
# a schedule and must never flood the 2-worker export pool and starve live crew
# syncs. A large backlog drains over successive cycles (and the office can clear
# the bulk on demand with the manual backfill tool at 100/sync/request).
RECONCILE_MAX_PER_CYCLE = 100


def reconcile_all_missing(db: Session, max_total: int = RECONCILE_MAX_PER_CYCLE) -> Dict[str, Any]:
    """Self-heal every backfillable sync: audit Postgres against the Sheet once,
    then re-drive the records that never landed, up to a per-cycle budget. This is
    the durable "retry until it lands" the once-at-write-time export lacked - a
    failed materials/report/RODS/etc. export is re-driven on the next cycle and
    keeps being re-driven until the sheet shows it, exactly as events and BOLs
    already self-heal via their own reconcilers.

    Reuses the manual backfill's audit + `_re_*` drivers, so there is one
    re-export code path. Safe to run on a schedule: the audited exports are
    replace-style (keyed delete-before-write), so re-driving a record that is
    actually present rewrites its row rather than duplicating it. A record whose
    export genuinely throws every time is re-driven each cycle but stays visible
    as a persistent failure in the Sheet-record health check (its `last_error`),
    so the churn is bounded and surfaced, not silent.

    Returns {ok, queued, per_sync, remaining_missing}. Never raises - the caller
    is a background loop that must not die."""
    try:
        audit = audit_sheet_backfill(db)
    except Exception as e:  # noqa: BLE001 - never take down the reconcile loop
        return {"ok": False, "error": str(e), "queued": 0, "per_sync": {}, "remaining_missing": 0}
    if not audit.get("connected"):
        return {"ok": False, "error": audit.get("error") or "sheets not connected",
                "queued": 0, "per_sync": {}, "remaining_missing": 0}

    budget = max(0, int(max_total))
    total_queued = 0
    per_sync: Dict[str, int] = {}
    remaining_missing = 0
    for row in audit["results"]:
        if row.get("auto") or row.get("error"):
            continue
        remaining_missing += int(row.get("missing_count", 0) or 0)
        if budget <= 0:
            continue
        ids = [m["id"] for m in row.get("missing", [])][:budget]
        if not ids:
            continue
        try:
            res = reexport_missing(db, row["key"], ids)
        except Exception as e:  # noqa: BLE001 - one sync must not kill the sweep
            print(f"[reconcile-all] {row['key']} re-export failed: {e}")
            continue
        q = int(res.get("queued", 0) or 0)
        if q:
            per_sync[row["key"]] = q
            total_queued += q
            budget -= q
    return {"ok": True, "queued": total_queued, "per_sync": per_sync,
            "remaining_missing": remaining_missing}


def reexport_missing(db: Session, key: str, ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Re-drive the real export for the given records of one sync. When `ids` is
    omitted the audit is re-run for that sync and everything currently missing is
    queued, capped at MAX_REEXPORT_PER_REQUEST."""
    entry = _entry_for(key)
    if entry is None or entry.get("auto"):
        return {"ok": False, "error": f"'{key}' is not a backfillable sync", "queued": 0}

    records = {r["id"]: r for r in entry["source"](db)}

    if ids is None:
        audit = audit_sheet_backfill(db)
        row = next((r for r in audit["results"] if r["key"] == key), None)
        if row is None or row.get("error"):
            return {"ok": False, "error": (row or {}).get("error") or "audit failed", "queued": 0}
        ids = [m["id"] for m in row["missing"]]

    capped = ids[:MAX_REEXPORT_PER_REQUEST]
    queued, skipped = 0, 0
    for rid in capped:
        rec = records.get(rid)
        if rec is None:
            skipped += 1
            continue
        try:
            entry["reexport"](db, rec.get("ref", rid))
            queued += 1
        except Exception as e:  # noqa: BLE001 - keep going; report the rest
            print(f"[backfill] re-export failed for {key}/{rid}: {e}")
            skipped += 1

    return {
        "ok": True,
        "key": key,
        "queued": queued,
        "skipped": skipped,
        "not_queued": max(0, len(ids) - len(capped)),
        "cap": MAX_REEXPORT_PER_REQUEST,
    }
