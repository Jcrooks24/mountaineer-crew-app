"""
Payroll reimbursement rates - standardized company-wide $/unit figures the
office wants applied on the payroll page: mileage ($/mile) and per-diem
($/night). Stored as a SystemConfig JSON object under PAYROLL_RATES_KEY. Admin
edits them in Settings; the payroll summary reads them to turn crew-logged miles
and out-of-town nights into a dollar figure.

These are reimbursement / allowance rates, NOT hourly wages. Hourly pay still
lives only in QuickBooks (ADR 0029); these are standardized constants that
change over time, so they are configurable rather than hardcoded (ADR 0033).

Default 0 means "not set": the payroll page shows the miles / nights count with
no dollar figure until an admin enters a rate.
"""
from typing import Any, Dict, List

PAYROLL_RATES_KEY = "payroll_rates"

RATE_FIELDS: List[str] = ["mileage_rate", "per_diem_rate"]

DEFAULT_RATES: Dict[str, float] = {"mileage_rate": 0.0, "per_diem_rate": 0.0}


def normalize_rates(raw: Any) -> Dict[str, float]:
    """Coerce a stored or submitted object into clean, non-negative rates.
    Unknown keys are dropped; a bad or negative value falls back to the
    default (0.0), because a negative rate would silently subtract pay."""
    out = dict(DEFAULT_RATES)
    if isinstance(raw, dict):
        for k in RATE_FIELDS:
            v = raw.get(k)
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if f >= 0:
                out[k] = round(f, 4)
    return out
