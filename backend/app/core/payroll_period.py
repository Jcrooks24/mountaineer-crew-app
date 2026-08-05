"""
Current pay-period anchor.

There is no pay-period table: the payroll tool takes an ad-hoc start/end. But
the crew's Worked Hours summary wants to reflect the CURRENT pay period (the
open one since the last payroll), so we persist the most-recently *finalized*
period here (a SystemConfig JSON value) when the admin finalizes it. The crew
hours endpoint then windows its summary to "day after the last finalized period
end -> today".

Kept tiny and dependency-light so both the payroll router (writer) and the hours
router (reader) can share it without a circular import.
"""
import json
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.db.models.system_config import SystemConfig

PAYROLL_LAST_PERIOD_KEY = "payroll_last_period"


def set_last_finalized_period(db: Session, start: date, end: date) -> None:
    """Record a finalized payroll period. Keeps the LATEST one (by end date), so
    finalizing an older period out of order does not roll the crew window back.
    Does not commit - the caller owns the transaction."""
    row = db.query(SystemConfig).filter(SystemConfig.key == PAYROLL_LAST_PERIOD_KEY).first()
    if row and row.value:
        try:
            cur = json.loads(row.value)
            if cur.get("end") and str(cur["end"]) >= end.isoformat():
                return  # a newer (or equal) period is already recorded
        except Exception:
            pass
    payload = json.dumps({"start": start.isoformat(), "end": end.isoformat()})
    if row:
        row.value = payload
    else:
        db.add(SystemConfig(key=PAYROLL_LAST_PERIOD_KEY, value=payload))


def current_period_start(db: Session) -> Optional[date]:
    """Start of the open pay period = the day after the last finalized period's
    end. None when no payroll has ever been finalized (caller falls back to its
    rolling window)."""
    row = db.query(SystemConfig).filter(SystemConfig.key == PAYROLL_LAST_PERIOD_KEY).first()
    if not row or not row.value:
        return None
    try:
        end = date.fromisoformat(json.loads(row.value)["end"])
        return end + timedelta(days=1)
    except Exception:
        return None
