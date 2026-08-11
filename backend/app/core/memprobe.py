"""Resident-memory checkpoints for the long-running batch jobs.

Written for one specific recurring failure: the nightly sheet-integrity cron is
OOM-killed on the 512 MB Render worker, and an exit code 137 with no output tells
you *that* it died, not *where*. Two rounds of fixing-by-reading have now been
spent on that job. This module exists so the next round is driven by a number.

Design constraints, all load-bearing:

- **Stdlib only.** `psutil` is not in `requirements.txt` and a diagnostic must not
  add a production dependency.
- **Off unless asked.** `probe()` is a no-op until `enable()` is called or
  `MEMPROBE` is set, so the same calls can sit in `sheet_backfill`, which the
  admin backfill panel also calls on a live web worker.
- **Flushed on every line.** A process that is about to be OOM-killed does not get
  to flush its buffers. The last line that reaches the Render log before the kill
  is the whole point of this module, so every write is unbuffered. Do not
  "optimise" the flush away.
- **Never raises.** A diagnostic that can take down the job it is measuring is
  worse than no diagnostic. Every read is guarded and degrades to `None`.

On Linux (Render) both numbers come from `/proc/self/status`: `VmRSS` is current
resident size, `VmHWM` is the high-water mark since the process started. Off
Linux there is no `/proc`, so current RSS is unavailable and the peak falls back
to `resource.getrusage`; the checkpoints then print `n/a` rather than lying.
"""
from __future__ import annotations

import os
import sys
from typing import Optional

_TRUTHY = {"1", "true", "yes", "on"}

_enabled: bool = os.getenv("MEMPROBE", "").strip().lower() in _TRUTHY
_baseline_kb: Optional[int] = None
_last_kb: Optional[int] = None


def enable() -> None:
    """Turn probing on for this process. Callers that are always diagnostic (the
    integrity cron) call this instead of relying on the env var."""
    global _enabled
    _enabled = True


def disable() -> None:
    global _enabled
    _enabled = False


def enabled() -> bool:
    return _enabled


def _read_proc_status() -> str:
    """`/proc/self/status`, or an empty string anywhere that does not have it."""
    try:
        with open("/proc/self/status", "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def field_kb(status_text: str, field: str) -> Optional[int]:
    """Pull one `VmXxx:  N kB` field out of /proc status text.

    Split out from the file read so it can be tested against a captured sample on
    a machine that has no /proc - the parsing is the part that can be wrong, and
    it is verified rather than assumed.
    """
    prefix = field + ":"
    for line in status_text.splitlines():
        if line.startswith(prefix):
            parts = line.split()
            # "VmRSS:", "12345", "kB"
            if len(parts) >= 2 and parts[1].isdigit():
                return int(parts[1])
            return None
    return None


def current_kb() -> Optional[int]:
    """Current resident set size in KB, or None where it cannot be read."""
    return field_kb(_read_proc_status(), "VmRSS")


def peak_kb() -> Optional[int]:
    """Peak resident set size in KB since process start, or None."""
    kb = field_kb(_read_proc_status(), "VmHWM")
    if kb is not None:
        return kb
    # No /proc. getrusage reports ru_maxrss in KB on Linux and BYTES on macOS;
    # since this branch is only reached off Linux, the unit is not knowable here.
    # Report it only as a last resort and let the caller's label say "approx".
    try:
        import resource  # noqa: PLC0415 - absent on Windows; import where it is used
        return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    except Exception:  # noqa: BLE001 - a diagnostic must never raise
        return None


def _mb(kb: Optional[int]) -> str:
    return "n/a" if kb is None else f"{kb / 1024:.0f}Mi"


def probe(label: str) -> None:
    """Print one checkpoint: current RSS, the delta since the previous checkpoint,
    the delta since the first, and the peak. No-op unless enabled."""
    if not _enabled:
        return
    global _baseline_kb, _last_kb
    try:
        cur = current_kb()
        peak = peak_kb()
        parts = [f"rss={_mb(cur)}", f"peak={_mb(peak)}"]
        if cur is not None:
            if _last_kb is not None:
                parts.append(f"step={(cur - _last_kb) / 1024:+.0f}Mi")
            if _baseline_kb is None:
                _baseline_kb = cur
            else:
                parts.append(f"total={(cur - _baseline_kb) / 1024:+.0f}Mi")
            _last_kb = cur
        # flush: see the module docstring. An OOM kill is a SIGKILL - there is no
        # handler, no atexit, and no buffer flush. Unflushed lines are lost.
        print(f"[mem] {' '.join(parts)}  {label}", flush=True)
    except Exception as e:  # noqa: BLE001 - never take down the job being measured
        try:
            print(f"[mem] probe failed ({e}) {label}", file=sys.stderr, flush=True)
        except Exception:  # noqa: BLE001
            pass


def reset() -> None:
    """Forget the baseline, so a second phase can be measured from zero."""
    global _baseline_kb, _last_kb
    _baseline_kb = None
    _last_kb = None
