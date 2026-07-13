# 0012. The docs mirror authenticates as a user, not a service account

**Status:** Active.

## Context

The documentation set (README, ARCHITECTURE, CREDENTIALS, RUNBOOKS, VETTING_PROTOCOL,
CLAUDE, the handoff command, and every ADR) is mirrored into a Google Drive folder on
every push to `staging`, by `.github/workflows/sync-docs-to-drive.yml`. The point is
bus factor: a successor, or the owner on a phone, can read the docs without cloning
the repo or knowing what a repo is.

CI needs Google credentials to do that. The reflex choice for a machine talking to a
Google API is a **service account**, and it is the wrong choice here.

**A service account has no Google Drive storage quota of its own.** When it creates a
file, that file is owned by the service account, and the write fails with
`storageQuotaExceeded`. The usual escapes do not apply cleanly:

- A **shared drive** would work (files are owned by the drive, not the account), but it
  requires the docs to live in a shared drive rather than the owner's My Drive.
- **Domain-wide delegation** would work (the service account impersonates a real user),
  but it hands a CI credential the ability to act as any user in the Workspace, which
  is a far larger blast radius than a docs sync deserves.

The backend already solved this problem. `app/integrations/drive_upload.py` writes crew
photos, documents, and signed BOL PDFs to Drive using an **OAuth user token**, so every
file it creates is owned by the owner's Google account and draws on that account's
quota. See `app/core/google_cal_oauth.py`.

## Decision

The docs sync reuses the same OAuth user token the backend uses, supplied to GitHub
Actions as the `GOOGLE_OAUTH_TOKEN_JSON` repository secret. No service account is
introduced, and no new Google credential is minted.

Two consequences follow, and both are deliberate:

1. **The token is duplicated.** It lives in each environment's `system_config` table
   and now also in a GitHub secret. Rotating the Google token therefore means updating
   the GitHub secret too, or the sync silently starts failing. This is recorded in the
   rotation table in `docs/CREDENTIALS.md`.

2. **The folder must be created by the sync, not by hand.** The token's Drive scope is
   `drive.file`, which grants access only to files this OAuth client created. A folder
   made by hand in the Drive UI is invisible to the script and cannot be used as a
   parent. The script therefore does find-or-create on a folder by name, the same
   pattern `drive_upload.py` uses.

## Why it is written down

Both consequences look like defects to a fresh pair of eyes, and the obvious "fix" for
each makes things worse.

Someone will notice the token duplication and reach for a service-account key to clean
it up, and hit `storageQuotaExceeded` with no idea why, because the failure arrives at
upload time and says nothing about service accounts lacking storage.

Someone else will create the Drive folder by hand, point the script at its ID, watch it
404, and conclude the token is broken. It is not. It is `drive.file` behaving exactly
as documented.

## Consequences

- The Drive copy is one way. The repo is the source of truth, and anything edited in
  Drive is overwritten on the next push to `staging`. Every mirrored Doc carries a
  banner saying so.
- Files created in Drive are owned by the owner's Google account and count against its
  storage, which for a folder of text documents is negligible.
- If the docs sync ever needs to write somewhere the owner's account cannot reach, this
  decision must be revisited, and a shared drive is the first thing to look at.
