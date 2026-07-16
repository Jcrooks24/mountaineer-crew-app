#!/usr/bin/env python3
"""Mirror the bus-factor documentation set into a Google Drive folder.

Runs in CI on every push to `staging` (see .github/workflows/sync-docs-to-drive.yml).
Each markdown file is upserted into Drive as a native Google Doc, so a successor can
read and search the docs from a phone without cloning the repo.

The mirror is ONE WAY. The repo is the source of truth; anything edited in Drive is
overwritten on the next push. Each Doc carries a banner saying so.

Auth is the same Google OAuth user token the backend uses (see
app/core/google_cal_oauth.py), supplied here as the GOOGLE_OAUTH_TOKEN_JSON secret.
It is a user token, not a service account, on purpose: see
docs/decisions/0012-docs-mirror-oauth-not-service-account.md.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

REPO_ROOT = Path(__file__).resolve().parents[1]

# Must match app/core/google_cal_oauth.py exactly. google-auth resends the full
# scope list on every token refresh, and any scope that was not in the original
# grant trips `invalid_scope` and breaks the token for the backend too.
SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

FOLDER_NAME = os.getenv("DRIVE_DOCS_FOLDER_NAME", "Mountaineer Crew App Docs").strip()

GOOGLE_DOC_MIME = "application/vnd.google-apps.document"
FOLDER_MIME = "application/vnd.google-apps.folder"
MARKDOWN_MIME = "text/markdown"

# The documentation set, as glob patterns relative to the repo root. Patterns, not a
# hardcoded list, so a new ADR is picked up automatically the day it is written.
DOC_PATTERNS = [
    "README.md",
    "CLAUDE.md",
    "docs/ARCHITECTURE.md",
    "docs/CREDENTIALS.md",
    "docs/RUNBOOKS.md",
    "docs/VETTING_PROTOCOL.md",
    "docs/decisions/*.md",
    ".claude/commands/handoff.md",
]


def doc_title(rel_path: Path) -> str:
    """Repo path -> Drive title. `docs/decisions/README.md` becomes
    "docs - decisions - README", which disambiguates it from the root README and
    keeps the folder sorting in a sensible order."""
    parts = list(rel_path.with_suffix("").parts)
    return " - ".join(parts)


def collect_docs() -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for pattern in DOC_PATTERNS:
        matches = sorted(REPO_ROOT.glob(pattern))
        if not matches:
            print(f"  warning: no file matched `{pattern}`", file=sys.stderr)
        for path in matches:
            rel = path.relative_to(REPO_ROOT)
            if rel not in seen:
                seen.add(rel)
                out.append(rel)
    return out


def banner(rel_path: Path, sha: str) -> str:
    short = sha[:7] if sha else "unknown"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return (
        f"> **Mirrored automatically from the `staging` branch of "
        f"Jcrooks24/mountaineer-crew-app.**\n"
        f">\n"
        f"> The source of truth is `{rel_path.as_posix()}` in the repo. Edits made to "
        f"this document are **overwritten** on the next push. To change it, change the "
        f"repo.\n"
        f">\n"
        f"> Synced from commit `{short}` at {stamp}.\n\n"
    )


def with_retry(request, what: str, attempts: int = 4):
    """Retry Google's transient failures (rate limits, backend blips). A docs sync is
    not worth failing a build over a 429."""
    for attempt in range(attempts):
        try:
            return request.execute()
        except HttpError as exc:
            status = getattr(exc.resp, "status", None)
            transient = status in (429, 500, 502, 503, 504)
            if not transient or attempt == attempts - 1:
                raise
            delay = 2**attempt
            print(f"  {what}: {status}, retrying in {delay}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError("unreachable")


def get_credentials() -> Credentials:
    raw = os.getenv("GOOGLE_OAUTH_TOKEN_JSON", "").strip()
    if not raw:
        sys.exit(
            "GOOGLE_OAUTH_TOKEN_JSON is not set.\n"
            "Add the repo secret (Settings > Secrets and variables > Actions). Its value "
            "is the same authorized-user JSON the backend stores in system_config under "
            "`google_oauth_token`. See docs/CREDENTIALS.md."
        )
    try:
        creds = Credentials.from_authorized_user_info(json.loads(raw), SCOPES)
    except Exception as exc:
        sys.exit(f"GOOGLE_OAUTH_TOKEN_JSON is not valid authorized-user JSON: {exc}")

    if not creds.valid:
        if not (creds.expired and creds.refresh_token):
            sys.exit(
                "The Google token is invalid and cannot be refreshed (no refresh_token). "
                "Regenerate it and update the GOOGLE_OAUTH_TOKEN_JSON secret."
            )
        creds.refresh(Request())
    return creds


def find_or_create_folder(svc, name: str) -> str:
    """`drive.file` scope only exposes files this OAuth client created, so this finds a
    folder it made on a previous run, and otherwise makes one. A folder created by hand
    in the Drive UI is invisible to us and cannot be used as a parent."""
    escaped = name.replace("'", "\\'")
    q = (
        f"name = '{escaped}' and mimeType = '{FOLDER_MIME}' "
        f"and trashed = false and 'root' in parents"
    )
    found = with_retry(
        svc.files().list(q=q, fields="files(id, name)", pageSize=1), "folder lookup"
    ).get("files", [])
    if found:
        print(f"Folder: {name} (existing)")
        return found[0]["id"]

    created = with_retry(
        svc.files().create(
            body={"name": name, "mimeType": FOLDER_MIME}, fields="id"
        ),
        "folder create",
    )
    print(f"Folder: {name} (created)")
    return created["id"]


def existing_docs(svc, folder_id: str) -> dict[str, str]:
    """Title -> fileId for everything already in the folder."""
    out: dict[str, str] = {}
    page = None
    while True:
        resp = with_retry(
            svc.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="nextPageToken, files(id, name)",
                pageSize=100,
                pageToken=page,
            ),
            "folder listing",
        )
        for f in resp.get("files", []):
            out[f["name"]] = f["id"]
        page = resp.get("nextPageToken")
        if not page:
            break
    return out


def upsert(
    svc, folder_id: str, rel_path: Path, sha: str, known: dict[str, str], stage: Path
) -> str:
    """Create or update one Doc. Updating in place (rather than delete + recreate) keeps
    the Drive file ID stable, so any link a person has saved to a doc keeps working."""
    title = doc_title(rel_path)
    body_md = banner(rel_path, sha) + (REPO_ROOT / rel_path).read_text(encoding="utf-8")

    # MediaFileUpload wants a real file on disk, and the banner means the content is no
    # longer what is in the checkout. Stage the decorated copy outside the repo, so a
    # local run can never leave an untracked file behind.
    staged = stage / f"{title}.md"
    staged.write_text(body_md, encoding="utf-8")

    # resumable=False: these are kilobytes, and a simple upload is one round trip.
    media = MediaFileUpload(str(staged), mimetype=MARKDOWN_MIME, resumable=False)

    file_id = known.get(title)
    if file_id:
        with_retry(
            svc.files().update(fileId=file_id, media_body=media, fields="id"),
            f"update {title}",
        )
        print(f"  updated  {title}")
        return file_id

    created = with_retry(
        svc.files().create(
            body={"name": title, "mimeType": GOOGLE_DOC_MIME, "parents": [folder_id]},
            media_body=media,
            fields="id",
        ),
        f"create {title}",
    )
    print(f"  created  {title}")
    return created["id"]


def main() -> int:
    sha = os.getenv("GITHUB_SHA", "")
    docs = collect_docs()
    if not docs:
        sys.exit("No documentation files matched. Refusing to sync an empty set.")

    creds = get_credentials()
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)

    folder_id = find_or_create_folder(svc, FOLDER_NAME)
    known = existing_docs(svc, folder_id)

    print(f"Syncing {len(docs)} documents:")
    synced: set[str] = set()
    with tempfile.TemporaryDirectory(prefix="docs-sync-") as tmp:
        stage = Path(tmp)
        for rel in docs:
            upsert(svc, folder_id, rel, sha, known, stage)
            synced.add(doc_title(rel))

    # Renamed or deleted docs leave their old Doc behind. Say so rather than deleting:
    # a stale doc is a nuisance, but silently destroying something a person may have
    # linked to is worse. Remove it by hand in Drive.
    orphans = sorted(set(known) - synced)
    if orphans:
        print("\nIn the folder but no longer in the repo (delete by hand if stale):")
        for name in orphans:
            print(f"  {name}")

    print(f"\nDone. https://drive.google.com/drive/folders/{folder_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
