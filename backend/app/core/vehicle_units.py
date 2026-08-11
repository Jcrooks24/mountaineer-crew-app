"""
Vehicle-unit fleet registry.

Per-truck weight and dimension data for DOT weight compliance: dry (empty)
weight, GVWR, overall dims, and per-axle capacities. Stored as a SystemConfig
JSON list under VEHICLE_UNITS_KEY. Admin edits it in Settings; DVIR, BOLs, and
the inventory weight flags read it (payload capacity = GVWR - dry weight).

Seeded name-only from the DVIR unit list so the fleet shows up immediately and
the admin fills in the numbers - no stale hardcoded weights to drift.
"""
from typing import Any, Dict, List, Optional

VEHICLE_UNITS_KEY = "vehicle_units"

DEFAULT_UNIT_NAMES = ["26INT", "24FR8", "16FORD"]

_NUM_FIELDS = ["dry_weight_lbs", "gvwr_lbs", "length_ft", "width_ft", "height_ft"]


def default_units() -> List[Dict[str, Any]]:
    return [{"name": n, "axle_capacities_lbs": []} for n in DEFAULT_UNIT_NAMES]


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def normalize_units(raw: Any) -> List[Dict[str, Any]]:
    """Coerce a stored or submitted list into clean unit dicts. Drops entries
    with no name; numeric fields become float or None; axle capacities become a
    clean list of numbers. Field set is fixed so the admin editor stays stable."""
    out: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return out
    for u in raw:
        if not isinstance(u, dict):
            continue
        name = str(u.get("name") or "").strip()
        if not name:
            continue
        unit: Dict[str, Any] = {"name": name}
        for f in _NUM_FIELDS:
            unit[f] = _num(u.get(f))
        axles = u.get("axle_capacities_lbs")
        unit["axle_capacities_lbs"] = (
            [a for a in (_num(x) for x in axles) if a is not None]
            if isinstance(axles, list) else []
        )
        notes = str(u.get("notes") or "").strip()
        if notes:
            unit["notes"] = notes
        out.append(unit)
    return out
