"""
Driver Qualification (DQ) document types (C4).

The catalog of documents that make up a driver's DQ file. Each type has an
audience - "driver" (the driver is responsible: a medical card, the annual
certification of violations, the employment application) or "admin" (the office
fills it for the driver: the road-test form and certificate) - and a `required`
flag that drives the missing-docs reminder.

Stored as a SystemConfig JSON list under DQ_DOC_TYPES_KEY. Read by the driver
(to know what their file needs) and by admin (to edit the catalog), like the
other config lists. Uploaded/submitted documents live in the dq_documents table.
"""
from typing import Any, Dict, List

DQ_DOC_TYPES_KEY = "dq_doc_types"

AUDIENCES = ("driver", "admin")


def default_types() -> List[Dict[str, Any]]:
    return [
        {"key": "medical_cert", "name": "Medical Examiner's Certificate", "audience": "driver", "required": True},
        {"key": "annual_cert_violations", "name": "Annual Driver's Certification of Violations", "audience": "driver", "required": True},
        {"key": "employment_application", "name": "Driver's Employment Application", "audience": "driver", "required": True},
        {"key": "road_test_form", "name": "Driver's Road Test Form", "audience": "admin", "required": True},
        {"key": "road_test_certificate", "name": "Driver's Road Test Certificate", "audience": "admin", "required": True},
    ]


def _slug(s: str, i: int) -> str:
    base = "".join(c if c.isalnum() else "_" for c in (s or "").strip().lower()).strip("_")
    return base or f"doc_{i}"


def normalize_types(raw: Any) -> List[Dict[str, Any]]:
    """Coerce a stored or submitted list into clean doc types. Drops items with
    no name; keys are made unique + stable so a driver's stored documents stay
    matched to their type across a catalog edit."""
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    seen: set = set()
    for i, it in enumerate(raw):
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()
        if not name:
            continue
        key = str(it.get("key") or "").strip() or _slug(name, i)
        base = key
        n = 2
        while key in seen:
            key = f"{base}_{n}"
            n += 1
        seen.add(key)
        audience = str(it.get("audience") or "driver").strip().lower()
        if audience not in AUDIENCES:
            audience = "driver"
        out.append({
            "key": key,
            "name": name,
            "audience": audience,
            "required": bool(it.get("required", True)),
        })
    return out
