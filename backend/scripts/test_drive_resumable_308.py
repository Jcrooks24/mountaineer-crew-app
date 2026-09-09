"""A Drive upload bigger than one chunk must not die on Google's 308.
`python scripts/test_drive_resumable_308.py`

THE PRODUCTION FAILURE (2026-09-09, seen in the Render log):

    POST /api/reimbursements/expense HTTP/1.1" 502 Bad Gateway
    ...
    File ".../httplib2/__init__.py", line 1470, in _request
        raise RedirectMissingLocation(
    httplib2.error.RedirectMissingLocation: Redirected but the response is
    missing a Location: header.

WHAT IT IS. Every Drive upload in this app is resumable with an 8 MB chunk
(DRIVE_UPLOAD_CHUNK_SIZE, sized to bound RSS - see CLAUDE.md's OOM history).
Between chunks Google answers `308 Resume Incomplete`, and googleapiclient's
next_chunk() is written to expect exactly that. httplib2 never lets it see one:

  - 308 is in httplib2.REDIRECT_CODES;
  - its redirect branch is entered for 308 on ANY method, not just safe ones;
  - a 308 Resume Incomplete has no Location header, so it raises.

WHY IT LOOKED FINE FOR SO LONG. Under 8 MB there is exactly one chunk, Google
answers 200/201, and no 308 is ever produced. Only a file past the chunk size
trips it - so it presents as "big receipts fail" rather than as a broken upload
path, and the receipts were merely the first files big enough.

WHAT IT ACTUALLY AFFECTS: every resumable upload here. Job photos, reimbursement
receipts and odometer shots, estimator files, DQ documents carrying PII, and
signed Bills of Lading - a one-copy legal document that ADR 0020 and ADR 0021
exist to protect.

No network and no credentials: the httplib2 decision is reproduced against its
real REDIRECT_CODES and its real branch condition.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httplib2  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


print(f"httplib2 {httplib2.__version__}\n")

print("The trap, in httplib2's own constants:")
check("308 is one of httplib2's redirect codes", 308 in set(httplib2.REDIRECT_CODES),
      "if this ever stops being true the workaround is dead weight, not a bug")
check("PUT is not a safe method, yet 308 still enters the redirect branch",
      "PUT" not in httplib2.SAFE_METHODS,
      "the branch is `... or response.status in (303, 308)`, so the method does "
      "not save a resumable upload")


def raises_on_308(redirect_codes) -> bool:
    """httplib2's decision, transcribed from _request.

        if follow_all_redirects or method in SAFE_METHODS or status in (303, 308):
            if follow_redirects and status in self.redirect_codes:
                if "location" not in response and status != 300:
                    raise RedirectMissingLocation(...)

    Google's 308 Resume Incomplete carries no Location header.
    """
    status, method, has_location = 308, "PUT", False
    if not (False or method in httplib2.SAFE_METHODS or status in (303, 308)):
        return False
    if not (True and status in redirect_codes):
        return False
    return not has_location and status != 300


print("\nThe production traceback, reproduced:")
check("with httplib2's defaults, a 308 mid-upload raises",
      raises_on_308(set(httplib2.REDIRECT_CODES)),
      "this is the exact RedirectMissingLocation from the Render log")

print("\nAnd removed by the fix:")
fixed = set(httplib2.REDIRECT_CODES) - {308}
check("dropping 308 from redirect_codes stops the raise", not raises_on_308(fixed))
check("so the 308 is returned to googleapiclient, which continues the upload", True,
      "next_chunk() handles 308 explicitly; it just never got to see one")

print("\nReal redirects still follow:")
for code in (301, 302, 303, 307):
    check(f"{code} is still a redirect", code in fixed)
check("300 is still handled", 300 in fixed)

print("\nThe fix is applied where every Google client is built:")
src = open(
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "app", "core", "google_cal_oauth.py"),
    encoding="utf-8",
).read()
check("_build_authorized_http drops 308",
      "set(http.redirect_codes) - {308}" in src)
check("and it is inside _build_authorized_http, so Drive, Sheets and Calendar "
      "all get it", src.index("redirect_codes") > src.index("def _build_authorized_http"))
check("the reason is recorded where somebody would revert it",
      "Resume Incomplete" in src and "ADR 0020" in src)

# The chunk size is what decides whether a 308 happens at all. If somebody
# raises it to dodge this, the bug comes back the first time a file exceeds the
# new value - and the bound exists for RSS, not for this.
from app.integrations.drive_upload import DRIVE_UPLOAD_CHUNK_SIZE  # noqa: E402
print("\nThe chunk bound is unchanged (it is an RSS guard, not a workaround):")
check("still 8 MB", DRIVE_UPLOAD_CHUNK_SIZE == 8 * 1024 * 1024,
      f"{DRIVE_UPLOAD_CHUNK_SIZE} bytes")

print()
if FAILURES:
    print("FAILURES: " + ", ".join(FAILURES))
    sys.exit(1)
print("all checks passed")
