"""
Job checklist configuration (C3).

Admin-configurable checklist items shown on a job. Each item is either MANUAL
(the crew tick it) or AUTO (it ticks itself when the app sees the matching thing
happen for the job - a DVIR filed, the report saved, the BOL signed). Items can
be limited to long-distance jobs, to specific job types, and to jobs that have a
truck on them.

Stored as a SystemConfig JSON list under JOB_CHECKLIST_KEY. Read by the crew
(to render the checklist) and by admin (to edit it), like the vehicle-units and
payroll-rates config. The per-job tick state and the AUTO signals live
elsewhere (C3.2); this module is only the template.
"""
from typing import Any, Dict, List

JOB_CHECKLIST_KEY = "job_checklist_items"

# The fixed vocabulary of AUTO signals an item can bind to. "" means manual.
# The crew-facing signals endpoint (C3.2) computes a bool for each of these per
# job; keep the two in sync.
AUTO_SIGNALS: Dict[str, str] = {
    "": "Manual (crew ticks it)",
    "pretrip_dvir": "A pre-trip DVIR is submitted",
    "posttrip_dvir": "A post-trip DVIR is submitted",
    "job_report": "The job report is completed",
    "bol_origin_signed": "The BOL is signed at origin",
    "bol_delivered": "The BOL is signed at destination",
    "inventory": "Actual inventory has items",
    "weighed": "A loaded weight is logged",
    "pods": "PODS is filed",
    "rods": "RODS is filed",
}


def default_items() -> List[Dict[str, Any]]:
    """The standard checklist, seeded so a fresh install shows something useful.
    Local items first, then the long-distance-only additions.

    `requires_truck` is set on the five items that only make sense when a truck
    is on the job: both DVIRs, sweeping the truck out, the DOT markings on its
    door, and weighing it at a scale. This list seeds a FRESH install only - an existing install has
    its own list in SystemConfig, and normalize_items deliberately does not
    back-fill this flag onto it (see there). Ticking the boxes on an existing
    install is an admin action.
    """
    return [
        {"key": "pretrip_dvir", "label": "Pre-trip DVIR submitted", "auto_key": "pretrip_dvir", "ld_only": False, "requires_truck": True, "job_types": []},
        {"key": "posttrip_dvir", "label": "Post-trip DVIR submitted", "auto_key": "posttrip_dvir", "ld_only": False, "requires_truck": True, "job_types": []},
        {"key": "trucks_swept", "label": "Trucks swept out", "auto_key": "", "ld_only": False, "requires_truck": True, "job_types": []},
        {"key": "gear_accounted", "label": "Company gear accounted for (4-wheel dolly, 2-wheel dolly, tool bag, straps, all blankets, consumables)", "auto_key": "", "ld_only": False, "requires_truck": False, "job_types": []},
        {"key": "incidents_reported", "label": "Incidents reported (if any)", "auto_key": "", "ld_only": False, "requires_truck": False, "job_types": []},
        {"key": "job_report", "label": "Job report completed", "auto_key": "job_report", "ld_only": False, "requires_truck": False, "job_types": []},
        {"key": "bol_origin", "label": "BOL signed at origin", "auto_key": "bol_origin_signed", "ld_only": True, "requires_truck": False, "job_types": []},
        {"key": "inventory", "label": "Complete item inventory", "auto_key": "inventory", "ld_only": True, "requires_truck": False, "job_types": []},
        {"key": "weighed", "label": "Weighed at a certified scale", "auto_key": "weighed", "ld_only": True, "requires_truck": True, "job_types": []},
        {"key": "bol_dest", "label": "BOL signed at destination", "auto_key": "bol_delivered", "ld_only": True, "requires_truck": False, "job_types": []},
        {"key": "pods", "label": "PODS completed (1 per driver per trip)", "auto_key": "pods", "ld_only": True, "requires_truck": False, "job_types": []},
        {"key": "rods", "label": "RODS completed (1 per drive-day per driver)", "auto_key": "rods", "ld_only": True, "requires_truck": False, "job_types": []},
        {"key": "dot_markings", "label": "DOT number, company name, and MC number displayed on truck", "auto_key": "", "ld_only": True, "requires_truck": True, "job_types": []},
    ]


def _slug(s: str, i: int) -> str:
    base = "".join(c if c.isalnum() else "_" for c in (s or "").strip().lower()).strip("_")
    return base or f"item_{i}"


def normalize_items(raw: Any) -> List[Dict[str, Any]]:
    """Coerce a stored or submitted list into clean checklist items. Drops items
    with no label; an unknown auto_key falls back to manual; keys are made unique
    and stable so per-job tick state (C3.2) keys survive an edit that reorders.

    `requires_truck` defaults to False when the field is absent, and is NOT
    back-filled by key from default_items(). An existing install's stored list is
    the admin's list, not ours: silently deciding that their "Pre-trip DVIR
    submitted" is truck-only would change what crews see on jobs without anyone
    asking for it, and the same key can carry a label an admin has since rewritten
    to mean something else. Absent means off; the admin ticks the boxes.
    """
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    seen: set = set()
    for i, it in enumerate(raw):
        if not isinstance(it, dict):
            continue
        label = str(it.get("label") or "").strip()
        if not label:
            continue
        key = str(it.get("key") or "").strip() or _slug(label, i)
        # Keep keys unique so two items never share tick state.
        base_key = key
        n = 2
        while key in seen:
            key = f"{base_key}_{n}"
            n += 1
        seen.add(key)
        auto_key = str(it.get("auto_key") or "").strip()
        if auto_key not in AUTO_SIGNALS:
            auto_key = ""
        job_types = it.get("job_types")
        job_types = (
            [str(t).strip() for t in job_types if str(t).strip()]
            if isinstance(job_types, list) else []
        )
        out.append({
            "key": key,
            "label": label,
            "auto_key": auto_key,
            "ld_only": bool(it.get("ld_only")),
            "requires_truck": bool(it.get("requires_truck")),
            "job_types": job_types,
        })
    return out
