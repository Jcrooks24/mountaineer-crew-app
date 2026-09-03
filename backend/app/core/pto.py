"""Paid time off: eligibility, the annual cap, and what is left.

THE RULES, as given by the office (2026-09-03):

  - Eligibility and the size of the allowance vary per person, and are set by
    hand on the employee roster. There is no accrual and no service-length
    formula: somebody decides a number and types it in.
  - The allowance is per CALENDAR year. It does not roll over and it is not
    pro-rated.
  - PTO does NOT count toward overtime. It is paid time, not worked time, and
    letting it push somebody past forty would pay overtime for hours nobody
    worked.
  - Logging PTO is refused when the person is not eligible, or when the year's
    allowance is used up.

WHY A CAP IS ENFORCED AT ALL, given the app does not otherwise stop people
logging hours: PTO is the one entry that draws down a finite pool. Every other
kind of hour records something that happened; a PTO entry SPENDS something, and
an app that lets a crew member spend an allowance they do not have creates a
disagreement between their expectation and their next payslip. It is cheaper to
refuse it at the point of entry than to unpick it in payroll.

The balance is derived from the entries, never stored. A stored running total is
a second source of truth that drifts the first time an entry is edited or
deleted, and this one would drift silently.
"""
from datetime import date
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

# `OffJobEntry.pay_structure` value that marks an entry as paid time off.
PTO_PAY_STRUCTURE = "pto"


def pto_year_bounds(year: int) -> tuple:
    """The calendar year, inclusive, as ISO strings for a text-column compare."""
    return (date(year, 1, 1).isoformat(), date(year, 12, 31).isoformat())


def pto_used_hours(db: Session, user_id: int, year: int) -> float:
    """PTO hours already logged by this person in `year`.

    Derived from the entries themselves so it cannot drift from them. Counts
    every PTO entry regardless of who created it, because an admin logging PTO on
    somebody's behalf still spends the same allowance.
    """
    from app.db.models.off_job_entry import OffJobEntry  # local: avoid a cycle

    lo, hi = pto_year_bounds(year)
    rows = (
        db.query(OffJobEntry.hours)
        .filter(
            OffJobEntry.submitted_by_id == user_id,
            OffJobEntry.pay_structure == PTO_PAY_STRUCTURE,
            OffJobEntry.work_date >= lo,
            OffJobEntry.work_date <= hi,
        )
        .all()
    )
    return round(sum(float(h or 0) for (h,) in rows), 2)


def pto_balance(
    db: Session, user: Any, year: int, exclude_entry_uuid: Optional[str] = None
) -> Dict[str, Any]:
    """Somebody's PTO position for one calendar year.

    `exclude_entry_uuid` leaves one entry out of the "used" figure. That is for
    an EDIT: the offline queue re-submits the same entry_uuid to change an entry,
    and counting the old value against the new one would refuse a correction that
    lowers the hours - "you cannot change 8 to 4 because you have already used
    8". The entry being replaced is not spent twice.

    `eligible` is a cap greater than zero. There is no separate flag: an
    allowance of zero and "not eligible" are the same fact, and two ways to say
    it would eventually disagree.
    """
    from app.db.models.off_job_entry import OffJobEntry  # local: avoid a cycle

    cap = float(getattr(user, "pto_hours_annual", 0) or 0)
    used = pto_used_hours(db, user.id, year)

    if exclude_entry_uuid:
        prior = (
            db.query(OffJobEntry)
            .filter(OffJobEntry.entry_uuid == exclude_entry_uuid)
            .first()
        )
        if (
            prior is not None
            and prior.submitted_by_id == user.id
            and (prior.pay_structure or "") == PTO_PAY_STRUCTURE
            and prior.work_date
            and pto_year_bounds(year)[0] <= prior.work_date <= pto_year_bounds(year)[1]
        ):
            used = round(used - float(prior.hours or 0), 2)

    # Clamp: an allowance lowered after the fact can leave somebody "over", and a
    # negative remainder reads as a debt the app has no way to collect.
    remaining = round(max(0.0, cap - used), 2)
    return {
        "year": year,
        "eligible": cap > 0,
        "cap_hours": round(cap, 2),
        "used_hours": round(max(0.0, used), 2),
        "remaining_hours": remaining,
    }


def check_pto_allowed(
    db: Session, user: Any, work_date: Optional[str], hours: float,
    exclude_entry_uuid: Optional[str] = None,
) -> Optional[str]:
    """Why this PTO entry may not be logged, or None if it may.

    Returns the message rather than raising, so the caller decides the status
    code and the crew member gets a sentence that says what to do about it.
    """
    if not work_date:
        return "A PTO entry needs the date it is for."
    try:
        year = int(work_date[:4])
    except (TypeError, ValueError):
        return "A PTO entry needs a valid date."

    bal = pto_balance(db, user, year, exclude_entry_uuid=exclude_entry_uuid)
    if not bal["eligible"]:
        return (
            "You are not set up for PTO. If that is wrong, ask the office to set "
            "your annual PTO hours on the roster."
        )
    if hours > bal["remaining_hours"]:
        return (
            f"That is more PTO than you have left for {year}. "
            f"You have {bal['remaining_hours']:g} of {bal['cap_hours']:g} hours "
            f"remaining."
        )
    return None
