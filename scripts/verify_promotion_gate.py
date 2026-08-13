"""Test the promotion gate itself.

    python scripts/verify_promotion_gate.py

THE GATE IS THE FIRST THING THE PROTOCOL TELLS YOU TO RUN, AND NOTHING CHECKED
IT. Two defects have been found in it, both by accident:

  - `788da49` a false negative in the deviation check, so an open deviation did
    not block a merge.
  - 2026-08-13, its header scraper read quoted strings out of COMMENTS, so a
    comment explaining a tri-state column made the report announce four new Sheet
    columns when there were two. Two of the four were sentence fragments. Nobody
    would have found those columns, because they did not exist - and section 2 of
    the checklist is where someone decides whether prod's tab order needs fixing
    by hand.

Each case below is one of those, or a near neighbour. A gate that reports
confidently and wrongly is worse than no gate: the whole point of running it
first is to spend human attention on what it cannot see.
"""

import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "promotion_gate", os.path.join(ROOT, "scripts", "promotion_gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


print("Header scraping ignores comments (the 2026-08-13 defect):")
# The exact shape that broke it: a comment containing quoted phrases, sitting
# inside the header list.
block = '''
    "job_uuid", "submitted_by",
    # the office could not tell "nobody filled this in" from
    # "the crew could not name a cause", so both are stored
    "variance_direction", "variance_cause_identified",
'''
import re  # noqa: E402
cols = re.findall(r'"([^"]*)"', gate._strip_comments(block))
check("only real columns are scraped", cols == [
    "job_uuid", "submitted_by", "variance_direction", "variance_cause_identified"],
    str(cols))
check("no sentence fragment survives",
      not any(" " in c for c in cols), str([c for c in cols if " " in c]))

print("\nA comment cannot hide a real column either:")
# The opposite failure: over-eager stripping that drops a legitimate column.
block2 = '''
    "a", "b",  # trailing comment after real columns
    "c",
'''
check("columns before a trailing comment are kept",
      re.findall(r'"([^"]*)"', gate._strip_comments(block2)) == ["a", "b", "c"],
      str(re.findall(r'"([^"]*)"', gate._strip_comments(block2))))

src = io.open(os.path.join(ROOT, "backend", "app", "integrations", "sheets_export.py"),
              encoding="utf-8").read()
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.setdefault("JWT_SECRET", "x")

print("\nNo real column contains a '#':")
# Line-wise comment stripping is only safe while this holds. Checked against the
# IMPORTED lists, not a regex scrape - scraping the raw text here would just
# re-find the comment the stripping exists to remove, which is what the first
# version of this check did.
import app.integrations.sheets_export as se  # noqa: E402
all_headers = {n: v for n, v in vars(se).items()
               if n.endswith("HEADERS") and isinstance(v, list)}
hashed = {n: [c for c in v if "#" in str(c)] for n, v in all_headers.items()}
hashed = {n: v for n, v in hashed.items() if v}
check(f"checked {len(all_headers)} header lists", not hashed, str(hashed))

print("\nThe scraper agrees with Python on the real file:")
from app.integrations.sheets_export import (  # noqa: E402
    JOB_REPORT_HEADERS, REPORT_WAIVER_HEADERS, EVENTS_HEADERS,
)
scraped = {}
for m in re.finditer(r"^([A-Z0-9_]*HEADERS)\s*(?::[^=]+)?=\s*\[(.*?)\]", src, re.M | re.S):
    scraped[m.group(1)] = re.findall(r'"([^"]*)"', gate._strip_comments(m.group(2)))
for name, real in [("JOB_REPORT_HEADERS", JOB_REPORT_HEADERS),
                   ("REPORT_WAIVER_HEADERS", REPORT_WAIVER_HEADERS),
                   ("EVENTS_HEADERS", EVENTS_HEADERS)]:
    check(f"{name} matches the imported list", scraped.get(name) == list(real),
          f"scraped {len(scraped.get(name, []))} vs real {len(real)}")

print("\nThe gate still has the checks it is supposed to have:")
gate_src = io.open(os.path.join(ROOT, "scripts", "promotion_gate.py"), encoding="utf-8").read()
for needle, why in [
    ("alembic", "a split migration chain must fail the gate"),
    ("DATA_FLOW_STAGING", "unmet fields and open deviations must fail the gate"),
    ("decisions", "duplicate ADR numbers must fail the gate"),
]:
    check(f"{why}", needle.lower() in gate_src.lower())

print("\nIt distinguishes an APPEND from a MID-LIST INSERT:")
# An append is safe; a mid-list insert leaves prod's tab in a different column
# ORDER than a fresh staging tab, which matters to anything reading by letter.
check("both classifications exist",
      "APPEND" in gate_src and "MID-LIST" in gate_src)
check("and a new tab is called out separately", "NEW TAB" in gate_src)
# The distinction matters: an APPEND is safe, but a MID-LIST insert leaves prod's
# tab in a different column ORDER than a freshly created staging tab, which is
# wrong for anything reading by column letter or index.
check("the mid-list case explains the consequence rather than just naming it",
      "mid-list" in gate_src.lower() and "inserted" in gate_src.lower())

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
