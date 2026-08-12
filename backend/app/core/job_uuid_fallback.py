"""The client's OFFLINE fallback job_uuid, ported to Python.

This is not used to mint anything. It exists so the server can compute, exactly,
which uuid a device WOULD have adopted for a given calendar event when
`/api/jobs/resolve` was unreachable - which is what makes forked jobs findable
deterministically rather than by guesswork.

Mirrors `calEventToJobUuid` in `frontend/src/lib/bolStore.ts` byte for byte. The
two are verified against each other in the repair script's self-test; if this
ever drifts from the frontend, the repair silently stops finding real forks and
starts reporting none, which looks like success. Do not "clean up" either side
without re-running that check.

Background: the server mints a random uuid4 for a calendar event, the client
falls back to this deterministic hash of the same event id, and the two can never
agree. A device that fell back therefore used a different identity for the same
job. See the Known defects entry in docs/RUNBOOKS.md.
"""
from __future__ import annotations

_MASK32 = 0xFFFFFFFF
_FNV_PRIME = 16777619
_FNV_OFFSET = 2166136261


def _fnv1a(s: str, seed: int = _FNV_OFFSET) -> int:
    """FNV-1a 32-bit over UTF-16 code units.

    `charCodeAt` yields UTF-16 code units, so a non-BMP character contributes two
    surrogate halves in JS. Python iterates code POINTS, which would hash such a
    string differently - so the string is encoded to UTF-16 and walked as code
    units to match. Calendar event ids are ASCII in practice; this is here so the
    port is correct rather than correct-for-the-inputs-we-happen-to-have.
    """
    h = seed & _MASK32
    for cu in _code_units(s):
        h ^= cu
        h = (h * _FNV_PRIME) & _MASK32
    return h & _MASK32


def _code_units(s: str):
    """UTF-16 code units, the way JS `charCodeAt` sees a string."""
    raw = s.encode("utf-16-le")
    for i in range(0, len(raw), 2):
        yield raw[i] | (raw[i + 1] << 8)


def cal_event_to_job_uuid(cal_id: str) -> str:
    """The uuid a device derives offline for a calendar event id."""
    a = _fnv1a(cal_id)
    b = _fnv1a(cal_id + "\x00")
    c = _fnv1a(cal_id + "\x01")
    d = _fnv1a(cal_id + "\x02")
    hex_str = "".join(f"{n:08x}" for n in (a, b, c, d))
    return "-".join([
        hex_str[0:8],
        hex_str[8:12],
        "4" + hex_str[13:16],
        f"{((int(hex_str[16:18], 16) & 0x3F) | 0x80):02x}" + hex_str[18:20],
        hex_str[20:32],
    ])


def manual_job_to_job_uuid(name: str, date: str) -> str:
    """Mirrors `manualJobToJobUuid`: the same fallback over a normalised
    (name, date) pair. Manual jobs use this on BOTH sides, so they do not fork -
    included because the repair script has to tell the two cases apart."""
    normalized = " ".join((name or "").strip().split()).lower()
    return cal_event_to_job_uuid(f"manual:{date}:{normalized}")
