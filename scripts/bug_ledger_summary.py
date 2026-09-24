"""Summarise docs/bugs/BUG_LEDGER.csv: incidence over time, detection, area, time live
in prod, and bug rates against the app's size (APP_SIZE.csv) and features (FEATURES.csv).

Read-only. Prints Markdown tables; the ones in docs/bugs/README.md came from this.

    python scripts/bug_ledger_summary.py              # every row
    python scripts/bug_ledger_summary.py --live-era   # drop pre-staging rows (before 2026-04-18)
"""
import csv
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs" / "bugs"
LEDGER = DOCS / "BUG_LEDGER.csv"
SIZE = DOCS / "APP_SIZE.csv"
FEATURES = DOCS / "FEATURES.csv"
DETECTIONS = ["vet", "field-reported", "owner-reported", "other"]


def table(header, rows):
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for r in rows:
        print("| " + " | ".join(str(c) for c in r) + " |")
    print()


def read(path):
    return list(csv.DictReader(path.open(encoding="utf-8"))) if path.exists() else []


def features_live(features, branch, month):
    """Features live on a branch at the end of `month` (yyyy-mm)."""
    col = "first_on_main_date" if branch == "main" else "first_on_staging_date"
    return sum(1 for f in features
               if f[col] and f[col][:7] <= month and not (f["removed_date"] and f["removed_date"][:7] <= month))


def rate(n, d, per=1):
    return round(n / d * per, 2) if d else ""


def main():
    rows = read(LEDGER)
    if "--live-era" in sys.argv:
        rows = [r for r in rows if r["era"] != "pre-staging"]
    size, features = read(SIZE), read(FEATURES)
    dets = DETECTIONS + sorted({r["detection"] for r in rows} - set(DETECTIONS))
    print(f"{len(rows)} defects\n")

    envs = ["prod", "staging", "unknown"]
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
    table(["month", "prod", "staging", "unknown"] + dets + ["total"],
          [[m, by[m]["prod"], by[m]["staging"], by[m]["unknown"]] + [by[m]["d:" + d] for d in dets]
           + [by[m]["prod"] + by[m]["staging"] + by[m]["unknown"]] for m in sorted(by)])

    if size:
        print("### Rates against size (prod bugs vs main, staging bugs vs staging)\n")
        sz = {(s["branch"], s["month"]): s for s in size}
        out = []
        for m in sorted(k for k in by if k != "undated"):
            mn, st = sz.get(("main", m)), sz.get(("staging", m))
            if not mn or not st:
                continue
            p, s_ = by[m]["prod"], by[m]["staging"]
            churn_m = int(mn["lines_added"]) + int(mn["lines_removed"])
            churn_s = int(st["lines_added"]) + int(st["lines_removed"])
            fm, fs = features_live(features, "main", m), features_live(features, "staging", m)
            out.append([m, mn["loc"], p, rate(p, int(mn["loc"]), 1000), churn_m, rate(p, churn_m, 1000),
                        fm or "", rate(p, fm), st["loc"], s_, rate(s_, churn_s, 1000), fs or "", rate(s_, fs)])
        table(["month", "main loc", "prod bugs", "per kloc", "main churn", "per k churned", "features on main",
               "per feature", "staging loc", "staging bugs", "per k churned", "features on staging",
               "per feature"], out)

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
