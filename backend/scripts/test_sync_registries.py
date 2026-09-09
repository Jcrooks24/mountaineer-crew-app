"""The two sheet-sync registries cannot drift apart.
`python scripts/test_sync_registries.py`

WHY THIS EXISTS. The same set of Sheet syncs is written down TWICE, by hand:

  sheets_export.SHEET_SYNC_REGISTRY   drives the health check - "is this sync
                                      working, does its tab exist, is its env
                                      var set?"
  sheet_backfill.BACKFILL_REGISTRY    drives the audit and re-export - "which
                                      records are in Postgres but never reached
                                      the sheet?"

A sync present in the first and missing from the second is the worse way round to
get it wrong. It looks healthy - the health check reports on the last attempt, so
a sync that has never been driven reads as fine - while being invisible to the
one tool that can find stranded records. Nothing would say so.

That is not hypothetical. `tips` was added to SHEET_SYNC_REGISTRY on 2026-09-09
and left out of BACKFILL_REGISTRY in the same commit, by the same person, in the
same sitting. The vetting protocol names "a new sync missing from the registry"
as a finding and it still got missed, because the protocol says *the* registry
and there are two.

No network, no credentials, no database.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.integrations.sheet_backfill import BACKFILL_REGISTRY  # noqa: E402
from app.integrations.sheets_export import SHEET_SYNC_REGISTRY  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


sync = {e["key"]: e for e in SHEET_SYNC_REGISTRY}
back = {e["key"]: e for e in BACKFILL_REGISTRY}

print(f"Health-check registry: {len(sync)} syncs. Backfill registry: {len(back)}.\n")

missing = sorted(set(sync) - set(back))
extra = sorted(set(back) - set(sync))
check("every sync is auditable", not missing,
      f"in SHEET_SYNC_REGISTRY but not BACKFILL_REGISTRY: {missing}. "
      "Add a source + reexport there, or the records cannot be found when an "
      "export dies.")
check("the backfill panel invents no syncs", not extra,
      f"in BACKFILL_REGISTRY but not SHEET_SYNC_REGISTRY: {extra}")

print("\nThe two agree on where each sync WRITES:")
for key in sorted(set(sync) & set(back)):
    s, b = sync[key], back[key]
    check(f"{key}: same tab env var and default",
          s["env"] == b["env"] and s["default"] == b["default"],
          f"health={s['env']}/{s['default']} backfill={b['env']}/{b['default']}")

print("\nEvery auditable sync can actually be audited and re-driven:")
for key, b in sorted(back.items()):
    if b.get("auto"):
        # Owned by auto_reconciler; deliberately not diffed here.
        continue
    check(f"{key}: has a key column, a source and a re-export",
          bool(b.get("key_cols")) and callable(b.get("source")) and callable(b.get("reexport")),
          f"key_cols={b.get('key_cols')} source={b.get('source')} reexport={b.get('reexport')}")

print("\nEvery sync names a real export function:")
import app.integrations.sheets_export as sx  # noqa: E402
for key, s in sorted(sync.items()):
    fn = s.get("fn") or ""
    check(f"{key}: {fn or '(none)'} exists",
          bool(fn) and callable(getattr(sx, fn, None)),
          "the status table keys on this name; a typo means the health check "
          "silently never matches a status row")

# The audit compares a source record's `id` against the tab's KEY COLUMN. If the
# declared key column is not actually a column the export writes, the comparison
# has nothing to match on and every record reads as missing - a panel screaming
# about hundreds of stranded rows that are all present. A typo is enough.
print("\nEvery declared key column is a column something actually writes:")
_hdrs = {n: getattr(sx, n) for n in dir(sx)
         if n.endswith("_HEADERS") and isinstance(getattr(sx, n), list)}
for key, b in sorted(back.items()):
    if b.get("auto"):
        continue
    kc = (b.get("key_cols") or [None])[0]
    check(f"{key}: {kc!r} exists in a headers constant",
          any(kc in cols for cols in _hdrs.values()),
          "not written by any export - the audit would report every record missing")


# -- Drive folders -----------------------------------------------------------
# Same theme, different resource. Every Drive folder the app writes to holds
# something with no second copy, and each is isolated between staging and prod by
# an explicit folder ID env var. A folder whose env var is not surfaced by the
# health check is one nobody can tell is unpinned - and an unpinned folder means
# both environments resolve the SAME real folder, which is how staging came to
# overwrite production's signed BOLs.
print("\nEvery Drive folder the app writes to is health-checked:")
import app.integrations.drive_upload as du  # noqa: E402

reported = {f["env"] for f in du.check_drive_folders()["folders"]}
declared = {
    getattr(du, name) for name in dir(du)
    if name.endswith("_ENV_VAR") and isinstance(getattr(du, name), str)
    and getattr(du, name).startswith("DRIVE_")
}
check("every DRIVE_* folder env var appears in the check",
      declared <= reported,
      f"declared in drive_upload but not reported: {sorted(declared - reported)}")
check("the check invents no folders", reported <= declared,
      f"reported but not declared: {sorted(reported - declared)}")

# needs_attention must actually track the env var, or the panel is decorative.
import os  # noqa: E402
_before = {f["env"]: f["needs_attention"] for f in du.check_drive_folders()["folders"]}
os.environ["DRIVE_BOL_FOLDER_ID"] = "test-folder-id"
_after = {f["env"]: f for f in du.check_drive_folders()["folders"]}
check("setting a folder ID clears its warning",
      _before["DRIVE_BOL_FOLDER_ID"] and not _after["DRIVE_BOL_FOLDER_ID"]["needs_attention"])
check("and the id is shown, so two environments can be told apart",
      _after["DRIVE_BOL_FOLDER_ID"]["folder_id"] == "test-folder-id")
del os.environ["DRIVE_BOL_FOLDER_ID"]
check("unsetting it brings the warning back",
      du.check_drive_folders()["folders"][0]["needs_attention"])

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
