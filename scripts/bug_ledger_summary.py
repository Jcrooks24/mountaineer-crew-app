"""Summarise docs/bugs/BUG_LEDGER.csv: incidence over time, detection, area, time live in prod.

Read-only. Prints Markdown tables; the ones in docs/bugs/README.md came from this.

    python scripts/bug_ledger_summary.py              # every row
    python scripts/bug_ledger_summary.py --live-era   # drop pre-staging rows (before 2026-04-18)
"""
import csv
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

LEDGER = Path(__file__).resolve().parent.parent / "docs" / "bugs" / "BUG_LEDGER.csv"


def table(header, rows):
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")
    print()


def main():
    rows = list(csv.DictReader(LEDGER.open(encoding="utf-8")))
    if "--live-era" in sys.argv:
        rows = [r for r in rows if r["era"] != "pre-staging"]
    print(f"{len(rows)} defects\n")

    envs = ["prod", "staging", "unknown"]
    dets = ["vet", "user-reported", "other"]

    print("### Environment x detection\n")
    c = Counter((r["environment"], r["detection"]) for r in rows)
    table(["environment"] + dets + ["total"],
          [[e] + [c[(e, d)] for d in dets] + [sum(c[(e, d)] for d in dets)] for e in envs])

    print("### By month (incident_date)\n")
    by = defaultdict(Counter)
    for r in rows:
        m = (r["incident_date"] or "undated")[:7]
        by[m][r["environment"]] += 1
        by[m]["d:" + r["detection"]] += 1
    table(["month", "prod", "staging", "unknown", "vet", "user-reported", "other", "total"],
          [[m, by[m]["prod"], by[m]["staging"], by[m]["unknown"], by[m]["d:vet"],
            by[m]["d:user-reported"], by[m]["d:other"],
            by[m]["prod"] + by[m]["staging"] + by[m]["unknown"]] for m in sorted(by)])

    print("### Prod defects by area\n")
    a = Counter(r["area"] for r in rows if r["environment"] == "prod")
    table(["area", "prod defects"], a.most_common())

    print("### Prod defects by severity\n")
    s = Counter(r["severity"] for r in rows if r["environment"] == "prod")
    table(["severity", "prod defects"], s.most_common())

    days = [int(r["days_live_in_prod"]) for r in rows if r["days_live_in_prod"].strip().lstrip("-").isdigit()]
    if days:
        print("### Days a prod defect was live before its fix reached main\n")
        table(["n", "median", "mean", "max"],
              [[len(days), statistics.median(days), round(statistics.mean(days), 1), max(days)]])


if __name__ == "__main__":
    main()
