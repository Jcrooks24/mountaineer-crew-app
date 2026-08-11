"""
Company (carrier) information - stored in SystemConfig under COMPANY_INFO_KEY,
edited by admin, and read app-wide (notably the BOL carrier block, which used to
be hardcoded in the frontend). Kept here so both the admin router (write) and the
public config router (read) share one default and one field list.

The defaults are the values that were hardcoded before this became configurable;
they are the fallback when nothing has been saved yet.
"""

from typing import Dict, List

COMPANY_INFO_KEY = "company_info"

COMPANY_FIELDS: List[str] = ["name", "address", "phone", "email", "dot", "mc"]

DEFAULT_COMPANY: Dict[str, str] = {
    "name": "Mountaineer Moving LLC",
    "address": "3021 S 27th Ave. #B, Bozeman, MT 59718",
    "phone": "(406) 201-9580",
    "email": "management@mountaineermoving.com",
    "dot": "4557708",
    "mc": "1811084",
}


def merge_company(stored: Dict[str, object] | None) -> Dict[str, str]:
    """Overlay saved non-empty string values onto the defaults, so a missing or
    blank field always falls back to a sensible value rather than an empty BOL."""
    merged = dict(DEFAULT_COMPANY)
    if isinstance(stored, dict):
        for k in COMPANY_FIELDS:
            v = stored.get(k)
            if isinstance(v, str) and v.strip():
                merged[k] = v.strip()
    return merged
