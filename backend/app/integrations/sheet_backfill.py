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
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import memprobe
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


def _src_report_waivers(db: Session) -> List[Dict[str, Any]]:
    """Jobs whose report requirement was waived, or was waived and then revoked.

    Deliberately NOT filtered to `report_waived == True`. A revoked waiver still
    has a row on the tab reading "not waived", and the audit compares what
    Postgres thinks should be there against what is - so filtering here would
    make every revoked waiver look like a row that ought to be deleted, and the
    two sides would disagree forever.
    """
    from app.db.models.admin_entry_status import AdminEntryStatus
    rows = (
        db.query(AdminEntryStatus)
        .filter(
            (AdminEntryStatus.report_waived.is_(True))
            | (AdminEntryStatus.report_waived_at.isnot(None))
        )
        .order_by(AdminEntryStatus.updated_at.desc())
        .all()
    )
    return [{
        "id": r.job_uuid,
        "label": f"waived by {r.report_waived_by_name or 'unknown'}"
                 if r.report_waived else "waiver revoked",
        "created_at": _iso(r.report_waived_at or r.updated_at),
    } for r in rows if r.job_uuid]


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


def _src_feature_requests(db: Session) -> List[Dict[str, Any]]:
    from app.db.models.feature_request import FeatureRequest
    rows = db.query(FeatureRequest).order_by(FeatureRequest.created_at.desc()).all()
    return [{
        "id": r.request_uuid,
        "label": f"{r.submitted_by_name or 'unknown'}: {(r.title or r.description or '')[:40]}".strip(),
        "created_at": _iso(r.created_at),
    } for r in rows if r.request_uuid]


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
        run_export_in_background,
        schedule_job_materials_bills_rebuild,
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
    # Scheduled, not fired directly. A backfill re-drives many submissions, and
    # several of them routinely belong to the SAME job - firing one rebuild each
    # is the burst that races into duplicate Materials lines. Coalescing also
    # means a job with eight submissions costs one rebuild here, not eight.
    schedule_job_materials_bills_rebuild(row.job_uuid, db)


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


def _re_report_waiver(db: Session, ref: Any) -> None:
    from app.db.models.admin_entry_status import AdminEntryStatus
    from app.routers.payroll import _queue_waiver_export
    row = db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == ref).first()
    if row:
        _queue_waiver_export(db, row)


def _re_off_job(db: Session, ref: Any) -> None:
    from app.db.models.off_job_entry import OffJobEntry
    from app.routers.off_job import _export
    row = db.query(OffJobEntry).filter(OffJobEntry.entry_uuid == ref).first()
    if row:
        _export(row)


def _re_bug_report(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_bug_report_export
    schedule_bug_report_export(str(ref))


def _re_feature_request(db: Session, ref: Any) -> None:
    from app.integrations.sheets_export import schedule_feature_request_export
    schedule_feature_request_export(str(ref))


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
    {"key": "report_waivers", "label": "Report waivers", "env": "SHEETS_REPORT_WAIVERS_TAB",
     "default": "ReportWaivers", "key_cols": ["job_uuid"],
     "source": _src_report_waivers, "reexport": _re_report_waiver},
    {"key": "bug_reports", "label": "Bug reports", "env": "SHEETS_BUGS_TAB",
     "default": "Bugs", "key_cols": ["bug_uuid"],
     "source": _src_bug_reports, "reexport": _re_bug_report},
    {"key": "feature_requests", "label": "Feature requests", "env": "SHEETS_FEATURE_REQUESTS_TAB",
     "default": "FeatureRequests", "key_cols": ["request_uuid"],
     "source": _src_feature_requests, "reexport": _re_feature_request},
]


# ── Backfill throttle ────────────────────────────────────────────────────────
# Re-driving one record is READ-expensive: its export does a header read, two
# spreadsheet metadata gets and a full key-column read - roughly four reads
# against a quota of 60 reads per minute per user. A hundred records is ~400
# reads, or about seven minutes of quota for a single sync.
#
# On 2026-08-12 an admin pressed the backfill twice and the export pool spent
# minutes in 429 backoff. Nothing was lost (the retry ladder handled it), but the
# Sheet stopped updating for everyone while it cleared.
#
# A plain in-flight lock around the REQUEST does not help: the endpoint returns
# as soon as work is QUEUED, so the lock would release while the pool was still
# reading. The throttle therefore runs on a deadline estimated from the size of
# the last batch, which outlives the request that queued it.
READS_PER_REEXPORT = 4
READS_PER_MINUTE = 60
# Never hold the door shut longer than this, however big the batch. A stuck
# throttle that cannot be cleared is worse than a second 429.
MAX_COOLDOWN_SECONDS = 600

_throttle_lock = threading.Lock()
_backfill_ready_at: float = 0.0  # time.monotonic() deadline


def backfill_cooldown_remaining() -> int:
    """Seconds until another backfill batch may be queued. 0 when free."""
    with _throttle_lock:
        return max(0, int(round(_backfill_ready_at - time.monotonic())))


def estimate_drain_seconds(count: int) -> int:
    """Roughly how long `count` queued records take to reach the Sheet.

    This is the SAME number the cooldown uses, deliberately: the throttle holds
    the door for as long as the batch should take, so if the operator is told a
    different figure than the door enforces, one of the two is a lie and the
    person waiting cannot tell which. Callers show this so "when can I re-run the
    audit and see whether it worked" has an answer other than "in a minute".

    It is an estimate of QUOTA time, not of work: ~4 reads per record against 60
    reads a minute. Live crew exports share that quota, so a busy afternoon runs
    longer. Rounding is upward - being told 3 minutes and waiting 4 is a much
    smaller annoyance than being told 3, re-running at 3, seeing records still
    missing, and concluding the tool is broken.
    """
    if count <= 0:
        return 0
    seconds = (count * READS_PER_REEXPORT) / READS_PER_MINUTE * 60.0
    return int(min(seconds, float(MAX_COOLDOWN_SECONDS)))


def note_backfill_queued(count: int) -> None:
    """Record that `count` records were queued, and hold the door for roughly as
    long as they will take to drain within quota."""
    if count <= 0:
        return
    seconds = float(estimate_drain_seconds(count))
    global _backfill_ready_at
    with _throttle_lock:
        _backfill_ready_at = max(_backfill_ready_at, time.monotonic() + seconds)


def reset_backfill_throttle() -> None:
    """Clear the cooldown. For tests and for an admin who knows the pool is idle."""
    global _backfill_ready_at
    with _throttle_lock:
        _backfill_ready_at = 0.0


def _norm_key(value: Any) -> str:
    """Compare keys without letting stray whitespace invent a missing record.

    The Availability sync keys on `f"{user_name}||{window_start}"`, and some
    roster names carry a trailing space, so the database produced
    `"Josh Fairmont ||2026-07-19"` while the sheet held `"Josh Fairmont||..."`.
    The nightly audit reported 20 records MISSING on a tab that actually had MORE
    rows than the database (208 vs 212) - which is the tell: a genuine missing
    record cannot make the sheet longer. Nothing was lost; the two sides were
    spelling the same key differently.

    Stripping each component compares like with like. Harmless for the uuid-keyed
    syncs, which have no whitespace to begin with, and it is a comparison-time
    normalisation only - neither side's stored value is changed. The underlying
    data hygiene (names saved with trailing spaces) is a separate problem and is
    NOT fixed here; this stops the canary crying wolf about it.
    """
    return "||".join(part.strip() for part in str(value).split("||"))


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

    memprobe.probe(f"audit: header batchGet ({len(header_ranges)} ranges)")

    columns = _batch_values(svc, sid, value_ranges, "COLUMNS") if value_ranges else {}
    memprobe.probe(f"audit: key-column batchGet ({len(value_ranges)} ranges)")

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
        # Bracketing every source query is the point of these probes. Each `_src_*`
        # is a full-table `.all()` of ORM entities, and they all share ONE Session,
        # so the identity map holds every row loaded by every earlier sync for the
        # rest of the audit. If that is what OOM-kills the nightly cron, it shows up
        # here as a step delta that never comes back down. Measure before changing.
        memprobe.probe(f"audit: loading source {key}")
        try:
            records = entry["source"](db)
        except Exception as e:  # noqa: BLE001 - one bad kind must not kill the audit
            # ROLL BACK, or the comment above is a lie. Postgres aborts the whole
            # transaction on the first failed statement and refuses every
            # subsequent one with InFailedSqlTransaction until someone rolls back.
            # Without this, one bad table takes out all seventeen audits AND the
            # Events/BOL counters below - the audit reports "not audited" across
            # the board and, worse, the FAIL count DROPS, because checks that
            # would have found real gaps never got to run. A clean-looking report
            # produced by a broken audit is the worst possible output here.
            #
            # Seen 2026-08-12: a single missing column on job_reports (new code
            # deployed ahead of its migration) blinded all 19 completeness checks
            # and made the nightly report look better than the night before.
            try:
                db.rollback()
            except Exception:  # noqa: BLE001 - nothing useful to do if this fails
                pass
            row_out["error"] = f"could not read from the database: {e}"
            row_out["in_db"] = 0
            row_out["missing"] = []
            row_out["missing_count"] = 0
            result["results"].append(row_out)
            continue

        row_out["in_db"] = len(records)
        memprobe.probe(f"audit: loaded source {key} ({len(records)} rows)")
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
                sheet_keys.add(_norm_key("||".join(str(p) for p in parts)))

        missing = [r for r in records if _norm_key(r["id"]) not in sheet_keys]
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
    # Why a record will not drain, when `failing` cannot say.
    #
    # `failing` compares this sync's last error against its last success, and a
    # sync where MOST records export fine reads as healthy - so 33 bills that
    # throw every time show up as "missing" with no explanation anywhere. These
    # are the actual exceptions the background pool hit, newest first.
    #
    # See the note in sheets_export: this is an in-memory ring, so an empty list
    # does NOT prove nothing failed. It proves nothing failed since the last
    # worker recycle.
    from app.integrations.sheets_export import export_pool_status, recent_export_failures
    result["recent_failures"] = recent_export_failures()
    # A saturated or stuck pool is the one failure this whole page cannot
    # otherwise show: nothing throws, nothing lands, and every count stays put.
    # Without it, "the backfill does nothing" and "the export threads are wedged"
    # look identical from here.
    result["export_pool"] = export_pool_status()
    return result


# Total records re-driven across ALL syncs in one auto-reconcile cycle.
#
# This was 100, which was NOT "well under the manual tool's cap" as the comment
# here used to claim - it was exactly equal to it, and it made the sweep the
# single largest consumer of a 60-read/minute quota. At ~4 reads per re-export,
# 100 records is ~400 reads, nearly SEVEN MINUTES of the entire project's read
# budget, spent by a background loop with nobody watching.
#
# That turned the self-heal into a self-sustaining failure (2026-08-13): the
# sweep queued 100 exports, the pool went into 429 backoff, the exports failed,
# the records stayed missing, and the next sweep re-drove the same records. The
# storm was manufacturing the very backlog it was trying to drain, and it
# starved live crew exports at the same time.
#
# 15 records is ~60 reads, about one minute of quota per 20-minute sweep, which
# leaves the pool free for live traffic and still drains a backlog of a few
# hundred within a day. A backlog bigger than that is an incident to look at,
# not something a background loop should try to brute-force.
RECONCILE_MAX_PER_CYCLE = 15


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

    Returns {ok, queued, per_sync, backlog}. Never raises - the caller
    is a background loop that must not die."""
    # RESPECT THE THROTTLE THIS FUNCTION SETS. Until 2026-08-13 the cooldown was
    # enforced only on the two manual admin endpoints, while this unattended
    # sweep - the one that runs every 20 minutes forever - both ignored it and
    # pushed its deadline forward. So the loop queued batch after batch into a
    # pool that was still draining the last one, and the admin pressing Backfill
    # got a 429 from a door the background loop had shut. Skipping a sweep costs
    # 20 minutes; not skipping costs the read quota everything else needs.
    waiting = backfill_cooldown_remaining()
    if waiting > 0:
        return {"ok": True, "queued": 0, "per_sync": {}, "backlog": None,
                "skipped_reason": f"previous batch still draining ({waiting}s)"}
    try:
        audit = audit_sheet_backfill(db)
    except Exception as e:  # noqa: BLE001 - never take down the reconcile loop
        return {"ok": False, "error": str(e), "queued": 0, "per_sync": {}, "backlog": None}
    if not audit.get("connected"):
        return {"ok": False, "error": audit.get("error") or "sheets not connected",
                "queued": 0, "per_sync": {}, "backlog": None}

    budget = max(0, int(max_total))
    total_queued = 0
    per_sync: Dict[str, int] = {}
    # The backlog measured BEFORE this sweep re-drove anything. It is not a
    # result, and the old name (`remaining_missing`) said otherwise: when the
    # budget covered the whole backlog the log read "40 re-driven, 40 still
    # missing" on every single cycle, including cycles where all 40 landed
    # perfectly. That line was read as proof the backfill was broken. Whether a
    # record actually landed is only knowable on the NEXT audit.
    backlog = 0
    for row in audit["results"]:
        if row.get("auto") or row.get("error"):
            continue
        backlog += int(row.get("missing_count", 0) or 0)
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
    note_backfill_queued(total_queued)
    # Carry the export pool's recent failures out with the result. When a
    # backlog is not shrinking, the reason is almost always sitting in this ring
    # (quota 429, a widened grid, a revoked token) and the operator's only route
    # to it used to be grepping Render logs for a line nobody knew to look for.
    from app.integrations.sheets_export import recent_export_failures
    return {"ok": True, "queued": total_queued, "per_sync": per_sync,
            "backlog": backlog, "failures": recent_export_failures()[:5],
            "drain_seconds": estimate_drain_seconds(total_queued)}


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

    note_backfill_queued(queued)
    return {
        "ok": True,
        "key": key,
        "queued": queued,
        "skipped": skipped,
        "not_queued": max(0, len(ids) - len(capped)),
        "cap": MAX_REEXPORT_PER_REQUEST,
        "drain_seconds": estimate_drain_seconds(queued),
    }
