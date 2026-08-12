"""Sort people by LAST name.

Payroll and the admin roster both list crew, and both used to sort on the full
name string, which is first-name order. That is fine for a handful of people and
useless for a roster: nobody looks up "DesCombaz" under J.

Mirrored in `frontend/src/lib/nameSort.ts`. The two must agree, or payroll (sorted
server-side) and the roster (sorted client-side) will disagree about the same
people and it will look like a bug in one of them. Change both together.
"""
from __future__ import annotations

import re

# Stripped from the END of a name before picking the surname, so "John Smith Jr."
# files under Smith rather than under J. Compared case-insensitively with any
# trailing dot removed, so "jr", "Jr" and "Jr." all match.
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "md", "phd", "dds", "esq"}

_WS = re.compile(r"\s+")


def surname_key(name: str | None, fallback: str | None = None) -> tuple:
    """A sort key that orders people by surname, then by the rest of the name.

    Returns a tuple so equal surnames fall back to the given name rather than to
    an arbitrary order, which keeps the list stable between reloads.

    The surname is the last whitespace-separated token after suffixes are
    removed. That is wrong for some compound surnames ("van der Berg" files under
    Berg), and deliberately so: guessing particles introduces its own errors, and
    the practical alternative is a separate surname field on the user record,
    which is a bigger change than this. Noted rather than silently accepted.
    """
    raw = (name or "").strip()
    if not raw:
        # No name at all: fall back to the email (or empty), so the row still
        # lands somewhere predictable instead of jumping around.
        alt = (fallback or "").strip().lower()
        return (alt, "")

    parts = [p for p in _WS.split(raw) if p]
    # Drop trailing suffixes, but never the only token - "Jr" alone is a name.
    while len(parts) > 1 and parts[-1].rstrip(".").lower() in _SUFFIXES:
        parts.pop()

    last = parts[-1].lower()
    rest = " ".join(parts[:-1]).lower()
    return (last, rest)


def sort_people(people: list, name_of=lambda p: p, email_of=lambda p: None) -> list:
    """Sort a list of people by surname. Returns a new list."""
    return sorted(people, key=lambda p: surname_key(name_of(p), email_of(p)))
