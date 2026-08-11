#!/usr/bin/env python3
"""Mechanical pre-promotion checks for staging -> main.

Run it locally before opening the promotion PR:

    python scripts/promotion_gate.py --base-ref origin/main

CI runs the same command on every PR targeting `main`
(.github/workflows/promotion-gate.yml), so a red gate here is a red gate there.

WHAT THIS IS NOT
================
This is the mechanical subset of docs/VETTING_PROTOCOL.md, nothing more. It
checks things a script can be certain about: duplicate ADR numbers, a split
migration chain, blocker markers left in the data-flow doc. It cannot tell you
whether a queue drains, whether a signed document survives a worker recycle, or
whether the app is legible in sunlight. A green gate means "nothing mechanical
is obviously wrong," never "this was vetted." Run /vet.

WAIVERS
=======
The protocol says a blocker clears by fixing it or by an explicit written waiver
from the user. To waive a check, add a line to docs/DATA_FLOW_STAGING.md:

    GATE-WAIVER: <check-id> <reason, including who decided and when>

An agent cannot waive its own finding. A waiver with no reason text is rejected.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DECISIONS = REPO / "docs" / "decisions"
DATA_FLOW_STAGING = REPO / "docs" / "DATA_FLOW_STAGING.md"
MIGRATIONS = REPO / "backend" / "alembic" / "versions"

failures: list[tuple[str, str]] = []
notes: list[str] = []


def fail(check_id: str, message: str) -> None:
    failures.append((check_id, message))


def load_waivers() -> dict[str, str]:
    """GATE-WAIVER: <check-id> <reason>  -- reason is mandatory."""
    waivers: dict[str, str] = {}
    if not DATA_FLOW_STAGING.exists():
        return waivers
    for line in DATA_FLOW_STAGING.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*GATE-WAIVER:\s*(\S+)\s+(.+?)\s*$", line)
        if m:
            check_id, reason = m.group(1), m.group(2).strip()
            if len(reason) < 15:
                fail("waiver", f"waiver for '{check_id}' has no usable reason: {line.strip()!r}")
                continue
            waivers[check_id] = reason
    return waivers


# ── check: ADR numbers are unique, and do not collide with the base branch ────
def check_adr_numbers(base_ref: str | None) -> None:
    if not DECISIONS.is_dir():
        return
    here: dict[str, list[str]] = defaultdict(list)
    for p in DECISIONS.glob("[0-9][0-9][0-9][0-9]-*.md"):
        here[p.name[:4]].append(p.name)

    for num, names in sorted(here.items()):
        if len(names) > 1:
            fail("adr-dupe", f"ADR {num} used by {len(names)} files: {', '.join(sorted(names))}")

    if not base_ref:
        return
    try:
        out = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", base_ref, "docs/decisions/"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        notes.append(f"could not read {base_ref}; skipped the cross-branch ADR check")
        return

    base: dict[str, str] = {}
    for path in out.splitlines():
        name = path.rsplit("/", 1)[-1]
        if re.match(r"^\d{4}-.*\.md$", name):
            base[name[:4]] = name

    for num, names in sorted(here.items()):
        base_name = base.get(num)
        if base_name and base_name not in names:
            fail(
                "adr-collision",
                f"ADR {num} is '{names[0]}' here but '{base_name}' on {base_ref}. "
                f"Merging produces two {num}s and every 'ADR {num}' reference becomes "
                f"ambiguous. Renumber before merging.",
            )
    # The same decision carrying two different numbers across branches.
    base_slugs = {n[5:]: n[:4] for n in base.values()}
    for num, names in sorted(here.items()):
        slug = names[0][5:]
        if slug in base_slugs and base_slugs[slug] != num:
            fail(
                "adr-renumbered",
                f"'{slug}' is ADR {num} here but ADR {base_slugs[slug]} on {base_ref}. "
                f"The same decision would land twice under two numbers.",
            )


# ── check: the migration chain has exactly one head ──────────────────────────
def check_single_alembic_head() -> None:
    """Parsed from the files rather than by importing alembic, so the gate needs
    no backend dependencies installed. Two heads means two branches each added a
    migration; Render runs `alembic upgrade head` at boot and fails on ambiguity."""
    if not MIGRATIONS.is_dir():
        return
    revs: dict[str, str] = {}
    downs: set[str] = set()
    for p in MIGRATIONS.glob("*.py"):
        text = p.read_text(encoding="utf-8")
        rev = re.search(r"^revision(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", text, re.M)
        if not rev:
            continue
        revs[rev.group(1)] = p.name
        for dm in re.finditer(r"^down_revision(?::[^=]+)?\s*=\s*(.+)$", text, re.M):
            for d in re.findall(r"['\"]([^'\"]+)['\"]", dm.group(1)):
                downs.add(d)

    heads = sorted(r for r in revs if r not in downs)
    if len(heads) > 1:
        listed = ", ".join(f"{h} ({revs[h]})" for h in heads)
        fail("alembic-heads", f"{len(heads)} migration heads, expected 1: {listed}")
    elif not heads and revs:
        fail("alembic-heads", "no migration head found; the chain may be circular")


# ── check: the data-flow doc reports no open blockers ────────────────────────
def check_data_flow_blockers() -> None:
    if not DATA_FLOW_STAGING.exists():
        fail("data-flow-missing", "docs/DATA_FLOW_STAGING.md is missing")
        return
    text = DATA_FLOW_STAGING.read_text(encoding="utf-8")

    # A real per-field row ends in a cell that IS the checkbox: `| ... | [ ] |`.
    # Matching any `[ ]` on a table row also hits the doc's own description of
    # the rule ("| Any `[ ]` in this doc | ..."), where it sits in backticks.
    unchecked = [
        ln.strip() for ln in text.splitlines()
        if re.search(r"\|\s*\[ \]\s*\|", ln)
    ]
    if unchecked:
        sample = unchecked[0][:110]
        fail(
            "data-flow-unchecked",
            f"{len(unchecked)} field(s) still '[ ]' in DATA_FLOW_STAGING.md - data the app "
            f"collects and then loses. First: {sample}",
        )

    m = re.search(r"^# Deviations new on staging\s*$(.*?)^# ", text, re.M | re.S)
    if m:
        deviations = re.findall(r"^###\s+(.+?)\s*$", m.group(1), re.M)
        if deviations:
            fail(
                "data-flow-deviations",
                f"{len(deviations)} deviation(s) new on staging block the merge: "
                + "; ".join(d[:60] for d in deviations),
            )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-ref", default=os.environ.get("GATE_BASE_REF") or None,
                    help="branch being merged INTO, e.g. origin/main")
    args = ap.parse_args()

    check_adr_numbers(args.base_ref)
    check_single_alembic_head()
    check_data_flow_blockers()

    waivers = load_waivers()
    active, waived = [], []
    for check_id, message in failures:
        if check_id in waivers:
            waived.append((check_id, message, waivers[check_id]))
        else:
            active.append((check_id, message))

    print("=" * 72)
    print("PROMOTION GATE (mechanical subset of docs/VETTING_PROTOCOL.md)")
    print("=" * 72)
    for n in notes:
        print(f"  note: {n}")
    for check_id, message, reason in waived:
        print(f"\n  WAIVED [{check_id}] {message}\n     waiver: {reason}")
    for check_id, message in active:
        print(f"\n  BLOCKED [{check_id}] {message}")

    if active:
        print(f"\n{len(active)} blocker(s). Fix them, or record a "
              f"'GATE-WAIVER: <check-id> <reason>' line in DATA_FLOW_STAGING.md.")
        print("A green gate would still not mean vetted. Run /vet.")
        return 1

    print("\n  No mechanical blockers." + (f" ({len(waived)} waived.)" if waived else ""))
    print("  This is NOT a vet. Run /vet before promoting.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
