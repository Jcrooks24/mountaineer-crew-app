"""Payroll hour rounding (request e2126bf1, 2026-09-03).
`python scripts/test_payroll_rounding.py`

WHY THIS EXISTS. Payroll summed RAW hours and rounded the total to two decimal
places. The Sheet and the job report quarter-rounded each entry. So the same
work produced two different numbers, and the one people were paid from was the
unrounded one. This is a MONEY path.

The distinction the request turns on is not cosmetic and is easy to get wrong:

    round-then-sum   three 2h05m jobs -> 2.25 + 2.25 + 2.25 = 6.75
    sum-then-round   three 2h05m jobs -> 6.25 -> 6.25

Half an hour apart on three jobs, and the first is what the crew member already
sees on their job reports. Rounding has to happen per contribution, before any
summing, which is what `_round_rows` does.

NOT DONE: no real historical payroll run was recomputed by hand against this.
Production data is not reachable from this machine and STEP 0 of the vetting
protocol asks for exactly that on a money change. It is still owed.

No network, no credentials, no database.
"""

import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.hours_rounding import (  # noqa: E402
    PAYROLL_ROUNDING_EFFECTIVE_FROM,
    payroll_rounds,
    round_billable_quarter,
)
from app.routers.payroll import _round_rows  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def h(hours, minutes):
    """Decimal hours from h:mm. Written out because `2.05` looks like two hours
    five minutes and is two hours THREE minutes, which is the whole reason this
    rounding rule is easy to get wrong. The first draft of this file made that
    mistake and reported the implementation as broken when it was correct."""
    return hours + minutes / 60


def row(hours, bucket="billable"):
    return {
        "user_id": 1, "user_name": "A", "date": date(2026, 9, 10), "bucket": bucket,
        "hours": hours, "source": "job", "source_key": "j", "source_label": "Job",
        "detail": "",
    }


print("The rule, from the request: 5 minutes in rounds up, else down")
# 0.0667h = 4 min, 0.0833h = 5 min.
check("8:04 rounds down to 8.00", round_billable_quarter(8 + 4 / 60) == 8.00)
check("8:05 rounds up to 8.25", round_billable_quarter(8 + 5 / 60) == 8.25)
check("8:19 rounds down to 8.25", round_billable_quarter(8 + 19 / 60) == 8.25)
check("8:20 rounds up to 8.50", round_billable_quarter(8 + 20 / 60) == 8.50)
check("exactly 8:15 stays 8.25", round_billable_quarter(8.25) == 8.25)
check("zero stays zero", round_billable_quarter(0) == 0.0)
check("negative does not go negative", round_billable_quarter(-3) == 0.0)

print("\nIt matches the frontend and the Sheet, which already round this way")
from app.integrations.sheets_export import _round_billable_quarter  # noqa: E402
same = all(
    _round_billable_quarter(v) == round_billable_quarter(v)
    for v in [0, 0.01, 1.07, 1.08, 2.05, 6.15, 8.0667, 8.0833, 8.3167, 8.3333, 12.9]
)
check("the Sheet's rounder and payroll's are now literally the same function", same)

print("\nTHE POINT OF THE REQUEST: round per job, THEN sum")
three = [row(h(2, 5)), row(h(2, 5)), row(h(2, 5))]     # three 2h05m jobs
rounded = _round_rows(three)
total_round_then_sum = sum(r["hours"] for r in rounded)
total_sum_then_round = round_billable_quarter(sum(r["hours"] for r in three))
check("each 2h05m job becomes 2.25", all(r["hours"] == 2.25 for r in rounded),
      str([r["hours"] for r in rounded]))
check("round-then-sum gives 6.75", total_round_then_sum == 6.75, str(total_round_then_sum))
check("sum-then-round would have given 6.25", total_sum_then_round == 6.25,
      str(total_sum_then_round))
check("the two genuinely differ, by half an hour on three jobs",
      total_round_then_sum - total_sum_then_round == 0.5)
# And the direction that costs the crew member: 2h03m rounds DOWN, three times.
under = _round_rows([row(h(2, 3)), row(h(2, 3)), row(h(2, 3))])
check("2h03m rounds down to 2.00, so rounding is not a one-way gift",
      all(r["hours"] == 2.0 for r in under), str([r["hours"] for r in under]))

print("\nA realistic week, worked by hand")
# Mon 8:05, Tue 7:58, Wed 8:20, Thu 6:04, Fri 9:12
week = [row(h(8, 5)), row(h(7, 58)), row(h(8, 20)), row(h(6, 4)), row(h(9, 12))]
got = [r["hours"] for r in _round_rows(week)]
expected = [8.25, 8.00, 8.50, 6.00, 9.25]
check("each day rounds as the crew's own job report shows it", got == expected, str(got))
check("the week totals 40.00", sum(got) == 40.0, str(sum(got)))
# The old rule summed the raw hours and kept two decimals: 39.65. Same week,
# 0.35h apart, and the crew member was paid the smaller number while their job
# reports showed them the larger one.
raw_total = round(sum(r["hours"] for r in week), 2)
check("the old rule would have paid 39.65 for the same week", raw_total == 39.65, str(raw_total))
check("so this week moves by 0.35h", round(sum(got) - raw_total, 2) == 0.35,
      str(round(sum(got) - raw_total, 2)))

print("\nPer-diem NIGHTS are a count, not a duration, and are left alone")
mixed = [row(h(2, 5)), row(1, bucket="per_diem_nights")]
out = _round_rows(mixed)
check("the night count is untouched",
      out[1]["hours"] == 1 and out[1]["bucket"] == "per_diem_nights")
check("and the hours row beside it still rounds", out[0]["hours"] == 2.25)

print("\nNon-billable and other buckets round too (all hours, per the request)")
for b in ("non_billable", "other"):
    r = _round_rows([row(h(3, 5), bucket=b)])[0]
    check(f"'{b}' rounds", r["hours"] == 3.25, str(r["hours"]))

print("\nRounding is NOT retroactive")
check("a period starting before the cutover does not round",
      not payroll_rounds(date(2026, 9, 3)))
check("a period starting on the cutover rounds",
      payroll_rounds(PAYROLL_ROUNDING_EFFECTIVE_FROM))
check("a later period rounds", payroll_rounds(date(2026, 12, 1)))
# Set a week out from the request date on purpose, so the first rounded period is
# one nobody had started reconciling. This asserts the gap rather than the date,
# so moving the cutover FORWARD (which the promotion checklist may require if the
# merge slips) passes, and moving it backwards onto reconciled periods fails.
check("the cutover is at least a week after the request date (2026-09-03)",
      (PAYROLL_ROUNDING_EFFECTIVE_FROM - date(2026, 9, 3)).days >= 7,
      f"{PAYROLL_ROUNDING_EFFECTIVE_FROM} is only "
      f"{(PAYROLL_ROUNDING_EFFECTIVE_FROM - date(2026, 9, 3)).days} days out")
# The guard against the real hazard: a fixed date plus an unknown promotion date.
# This cannot fail in CI on the day it is written, so it is a REMINDER, not a
# test - it prints rather than fails, and PROMOTION_CHECKLIST 7b is the real gate.
if PAYROLL_ROUNDING_EFFECTIVE_FROM <= date.today():
    print("  NOTE  the cutover is now in the PAST. Bump it before promoting, or "
          "already-reconciled periods will be restated (PROMOTION_CHECKLIST 7b).")

print("\n_round_rows does not mutate what it is given")
src = [row(h(2, 5))]
_round_rows(src)
check("the caller's rows are untouched", src[0]["hours"] == h(2, 5), str(src[0]["hours"]))
check("every other field survives the pass",
      set(_round_rows(src)[0].keys()) == set(src[0].keys()))

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
