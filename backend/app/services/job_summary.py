"""Per-job aggregation collated by job_uuid.

One place that pulls everything the app has recorded for a single job into a flat
payload, so a job can be seen whole. Shared by two endpoints:
  - admin  : GET /api/admin/job-summary/{uuid}  (include_admin=True)
  - crew   : GET /api/job-summary/{uuid}         (include_admin=False)

The crew variant drops the admin-only sections (admin_notes, entry_status) and is
what the crew-facing "closed job" panel renders. Both variants add job_setup and
checklist so that panel can show the header + checklist state without extra calls.

Every list is returned even when empty so the UI renders consistently; a corrupt
JSON column degrades to [] rather than 500ing the whole page (the point of this
endpoint is to show a job WHOLE).
"""
from __future__ import annotations

import json as _json
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.db.models.admin_entry_status import AdminEntryStatus
from app.db.models.admin_note import AdminNote
from app.db.models.bol import DigitalBOL
from app.db.models.dvir import DVIR
from app.db.models.event import Event
from app.db.models.incident import Incident
from app.db.models.job_bill import JobBill
from app.db.models.job_checklist_check import JobChecklistCheck
from app.db.models.job_inventory import JobInventoryItem
from app.db.models.job_report import JobReport
from app.db.models.job_setup import JobSetup
from app.db.models.long_distance import LdDay
from app.db.models.materials import MaterialsSubmission
from app.db.models.photo import Photo
from app.db.models.reimbursement import Reimbursement
from app.integrations.sheets_export import _incident_photo_urls
from app.routers.job_checklist import _job_signals
from app.routers.job_setup import _to_out as _job_setup_out

# Cap per-source pulls. The full source data is always available via the
# individual routers (or the Google Sheet) if a job somehow exceeds these; an
# unbounded .all() here was a memory cliff if a job's data ever drifted large.
JOB_SUMMARY_CAP = 1000


def _decode_json_list(raw: Optional[str]) -> list:
    """Decode a JSON-array text column, tolerating junk: one bad column degrades
    to an empty list rather than 500ing the whole summary."""
    if not raw:
        return []
    try:
        val = _json.loads(raw)
    except (ValueError, TypeError):
        return []
    return val if isinstance(val, list) else []


def _iso(dt: Any) -> Optional[str]:
    """Serialize a datetime for the JSON response. Naive datetimes in this app are
    stored as UTC; emit them with a trailing 'Z' so the browser doesn't reinterpret
    the bare ISO string in its local timezone (that made Job Summary show events 6h
    off from the Timeline tab)."""
    if dt is None:
        return None
    if isinstance(dt, datetime):
        s = dt.isoformat()
        if dt.tzinfo is None:
            s += "Z"
        return s
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


def _entry_status_json(row: AdminEntryStatus) -> Dict[str, Any]:
    return {
        "entered_by": row.entered_by,
        "entered_on": row.entered_on,
        "validated": bool(row.validated),
        "corrected": bool(row.corrected),
        "confirmed_in_sheet": bool(row.confirmed_in_sheet),
        "updated_by_name": row.updated_by_name,
        "updated_at": _iso(row.updated_at),
    }


def _checklist_state(db: Session, job_uuid: str) -> Dict[str, Any]:
    """The per-job checklist state (not the template): AUTO signals computed from
    the job's artifacts + the MANUAL tick map. Mirrors GET /api/job-checklist/status."""
    checks = db.query(JobChecklistCheck).filter(JobChecklistCheck.job_uuid == job_uuid).all()
    return {
        "signals": _job_signals(db, job_uuid),
        "manual": {c.item_key: bool(c.checked) for c in checks},
    }


def build_job_summary(db: Session, job_uuid: str, *, include_admin: bool) -> Dict[str, Any]:
    """Collate every source keyed by `job_uuid` into one payload. `include_admin`
    adds the admin-only sections (admin_notes, entry_status); crew callers pass
    False. Off-job hours, office hours and availability are deliberately absent:
    they are not job-scoped and cannot be joined here."""
    events = (
        db.query(Event).filter(Event.job_uuid == job_uuid)
        .order_by(Event.timestamp.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    dvirs = (
        db.query(DVIR).filter(DVIR.job_uuid == job_uuid)
        .order_by(DVIR.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    materials = (
        db.query(MaterialsSubmission).filter(MaterialsSubmission.job_uuid == job_uuid)
        .order_by(MaterialsSubmission.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    report = db.query(JobReport).filter(JobReport.job_uuid == job_uuid).first()
    bill = db.query(JobBill).filter(JobBill.job_uuid == job_uuid).first()
    photos = (
        db.query(Photo).filter(Photo.job_uuid == job_uuid)
        .order_by(Photo.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    inventory_items = (
        db.query(JobInventoryItem).filter(JobInventoryItem.job_uuid == job_uuid)
        .order_by(JobInventoryItem.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    incidents = (
        db.query(Incident).filter(Incident.job_uuid == job_uuid)
        .order_by(Incident.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    bol = (
        db.query(DigitalBOL).filter(DigitalBOL.job_uuid == job_uuid)
        .order_by(DigitalBOL.updated_at.desc()).first()
    )
    ld_days = (
        db.query(LdDay).filter(LdDay.job_uuid == job_uuid)
        .order_by(LdDay.date.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    reimbursements = (
        db.query(Reimbursement).filter(Reimbursement.job_uuid == job_uuid)
        .order_by(Reimbursement.created_at.asc()).limit(JOB_SUMMARY_CAP).all()
    )
    setup = db.query(JobSetup).filter(JobSetup.job_uuid == job_uuid).first()

    employee_hours = _decode_json_list(report.employee_hours_json) if report else []

    # Most-common job_name from events/materials so the header reads cleanly.
    name_candidates: List[str] = []
    for e in events:
        if e.job_name:
            name_candidates.append(e.job_name)
    for m in materials:
        if m.job_name:
            name_candidates.append(m.job_name)
    job_name = max(set(name_candidates), key=name_candidates.count) if name_candidates else ""

    out: Dict[str, Any] = {
        "job_uuid": job_uuid,
        "job_name": job_name,
        "job_setup": _job_setup_out(setup) if setup else None,
        "checklist": _checklist_state(db, job_uuid),
        "events": [
            {
                "event_id": e.event_id,
                "type": e.type,
                "timestamp": _iso(e.timestamp),
                "logged_at": _iso(e.logged_at),
                "note": e.note,
                "lat": e.lat,
                "lng": e.lng,
                "created_by": e.created_by,
            }
            for e in events
        ],
        "dvirs": [
            {
                "dvir_id": d.dvir_id,
                "inspection_type": d.inspection_type,
                "inspection_date": d.inspection_date,
                "vehicle_number": d.vehicle_number,
                "trailer_number": d.trailer_number,
                "condition": d.condition,
                "defects": _decode_json_list(d.defects_json),
                "defect_notes": d.defect_notes,
                "driver_name": d.driver_name,
                "mechanic_name": d.mechanic_name,
                "mechanic_signed_at": _iso(d.mechanic_signed_at),
                "created_at": _iso(d.created_at),
            }
            for d in dvirs
        ],
        "materials": [
            {
                "id": m.submission_id,
                "created_at": _iso(m.created_at),
                "notes": m.notes or "",
                "items": _decode_json_list(m.items_json),
                "total": float(m.total or 0),
            }
            for m in materials
        ],
        "job_report": None if not report else {
            "submitted_by_name": report.submitted_by_name,
            "last_edited_by_name": report.last_edited_by_name,
            "personal_vehicles": report.personal_vehicles,
            "bill_personal_vehicles": bool(report.bill_personal_vehicles),
            "dumpster_pct": report.dumpster_pct,
            "recycling_pct": report.recycling_pct,
            "billing_method": report.billing_method,
            "review_candidate": report.review_candidate,
            "hours_match": report.hours_match,
            "hours_verified": bool(report.hours_verified),
            "hours_mismatch_reason": report.hours_mismatch_reason,
            "job_type_tags": _decode_json_list(report.job_type_tags_json),
            "truck_fullness": _decode_json_list(report.truck_fullness_json),
            "out_of_town": bool(report.out_of_town),
            "has_crew_feedback": report.has_crew_feedback,
            "crew_feedback": report.crew_feedback or "",
            "overage_note": report.overage_note or "",
            "employee_hours": employee_hours,
            "created_at": _iso(report.created_at),
            "updated_at": _iso(report.updated_at),
        },
        "inventory": {
            "furniture_count": sum((it.qty or 0) for it in inventory_items if not it.is_box),
            "box_count": sum((it.qty or 0) for it in inventory_items if it.is_box),
            "items": [
                {
                    "name": it.name,
                    "qty": it.qty,
                    "is_box": bool(it.is_box),
                    "pack_type": it.pack_type,
                    "room": it.room,
                    "notes": it.notes,
                    "created_by_name": it.created_by_name,
                }
                for it in inventory_items
            ],
        },
        "incidents": [
            {
                "incident_uuid": i.incident_uuid,
                "claim_number": i.claim_number,
                "incident_date": i.incident_date,
                "severity": i.severity,
                "attributable": i.attributable,
                "attributed_crew": i.attributed_crew,
                "description": i.description,
                "est_cost": float(i.est_cost) if i.est_cost is not None else None,
                "resolved": bool(i.resolved),
                "notes": i.notes,
                "reported_by_name": i.reported_by_name,
                "photo_urls": _incident_photo_urls(db, i.incident_uuid, _decode_json_list(i.photo_urls)),
                "created_at": _iso(i.created_at),
            }
            for i in incidents
        ],
        "bol": None if not bol else {
            "bol_id": bol.bol_id,
            "status": bol.status,
            "item_count": len(_decode_json_list(bol.items_json)),
            "inventory_verified": getattr(bol, "inventory_verified", None),
            "inventory_note": getattr(bol, "inventory_note", None),
            "signed_pdf_url": getattr(bol, "signed_pdf_url", None),
            "updated_at": _iso(bol.updated_at),
        },
        "ld_days": [
            {
                "driver_name": ld.driver_name,
                "date": ld.date,
                "out_of_town": bool(ld.out_of_town),
                "drive_day": bool(ld.drive_day),
            }
            for ld in ld_days
        ],
        "reimbursements": [
            {
                "reimbursement_uuid": r.reimbursement_uuid,
                "type": r.type,
                "user_name": r.user_name,
                "amount": float(r.amount) if r.amount is not None else None,
                "category": r.category,
                "vendor": r.vendor,
                "status": r.status,
                "notes": r.notes,
                "created_at": _iso(r.created_at),
            }
            for r in reimbursements
        ],
        "bill": None if not bill else {
            "saved_by_name": bill.saved_by_name,
            "items": _decode_json_list(bill.items_json),
            "global_discount": float(bill.global_discount or 0),
            "notes": bill.notes or "",
            "updated_at": _iso(bill.updated_at),
        },
        "photos": [
            {
                "id": p.id,
                "caption": p.caption,
                "drive_url": p.drive_url,
                "created_by": p.created_by,
                "created_at": _iso(p.created_at),
            }
            for p in photos
        ],
    }

    if include_admin:
        admin_notes = (
            db.query(AdminNote).filter(AdminNote.job_uuid == job_uuid)
            .order_by(AdminNote.updated_at.desc()).limit(JOB_SUMMARY_CAP).all()
        )
        entry_status = (
            db.query(AdminEntryStatus).filter(AdminEntryStatus.job_uuid == job_uuid).first()
        )
        out["admin_notes"] = [
            {
                "id": n.id,
                "title": n.title,
                "body": n.body,
                "created_by_name": n.created_by_name,
                "updated_at": _iso(n.updated_at),
            }
            for n in admin_notes
        ]
        out["entry_status"] = _entry_status_json(entry_status) if entry_status else None

    return out
