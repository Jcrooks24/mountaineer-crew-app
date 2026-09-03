"""Company hour rounding, in one place.

THE RULE. Five minutes into a quarter hour rounds UP to that quarter; anything
less rounds DOWN. 8:04 is 8.00, 8:05 is 8.25, 8:19 is 8.25, 8:20 is 8.50.

WHY THIS MODULE EXISTS. The rule had two implementations that agreed by
coincidence: `_round_billable_quarter` in `integrations/sheets_export.py`, and
`roundBillableQuarter` in `frontend/src/lib/employeeHours.ts`. The payroll router
had NEITHER - it rounded to two decimal places and summed raw hours - so the
Sheet and payroll reported different totals for the same work, which is the
defect this module was extracted to fix.

Payroll cannot simply import the sheets_export copy: that module pulls in the
Google client libraries, and `CLAUDE.md` is explicit that the web worker's import
surface is load-bearing (the migration chain past ~24 modules OOM-killed a 512 MB
worker). So the rule moves down here, dependency-free, and both callers import
it.
"""
from datetime import date


def round_billable_quarter(hours: float) -> float:
    """Round `hours` to a quarter hour, rounding up from 5 minutes in.

    Examples:
      8.07 (8:04) -> 8.00
      8.08 (8:05) -> 8.25
      8.31 (8:19) -> 8.25
      8.34 (8:20) -> 8.50
    """
    if hours <= 0:
        return 0.0
    total_min = int(round(hours * 60))
    quarters = total_min // 15
    remainder = total_min - quarters * 15
    rounded_min = (quarters + 1) * 15 if remainder >= 5 else quarters * 15
    return rounded_min / 60.0


# ── When payroll starts rounding ─────────────────────────────────────────────
# Payroll rounding is NOT retroactive, at the user's direction (2026-09-03):
# periods before this were reconciled by hand and re-rounding them now would
# restate what people have already been paid.
#
# Applied by the period's START date, so a period is rounded or not rounded as a
# whole. A period that straddles this date keeps the old behaviour rather than
# mixing two rules inside one payroll run, which nobody could check by hand.
#
# Move this date to change the cutover. It is deliberately a constant and not a
# setting: it is answerable ("which payroll first used rounding?") only if it
# cannot be quietly changed and forgotten.
PAYROLL_ROUNDING_EFFECTIVE_FROM = date(2026, 9, 4)


def payroll_rounds(period_start: date) -> bool:
    """Whether a payroll period starting on `period_start` uses quarter rounding."""
    return period_start >= PAYROLL_ROUNDING_EFFECTIVE_FROM
