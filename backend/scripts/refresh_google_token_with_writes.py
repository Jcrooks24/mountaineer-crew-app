"""
One-shot OAuth flow that grants the *broader* scope set including
calendar.events — needed to enable the Crew Resources daily event
generator.

Don't run unless you're enabling Crew Resources. The deployed app's
SCOPES list is intentionally narrower so that token refreshes never
ask for a scope the user hasn't granted. This script hand-rolls the
flow against an inline broader scope list, so the resulting token's
grant covers calendar.events without touching the deployed SCOPES.

Usage:
    cd backend
    python scripts/refresh_google_token_with_writes.py

Requires backend/credentials.json (Desktop OAuth client). The script
opens a browser; sign in with the same Google account that owns your
calendars and click Allow. The resulting token.json prints to the
terminal — paste it into the admin UI at:
  Admin → Settings → Advanced Settings → Google Calendar → Update Token

Bypasses the prod _get_creds() entirely so the deployed SCOPES list
can stay narrow until you've confirmed the new token is live.
"""
import json
import sys
from pathlib import Path

# Add backend/ to path so app imports work
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google_auth_oauthlib.flow import InstalledAppFlow

BROADER_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

BASE_DIR = Path(__file__).resolve().parents[1]
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

if not CREDS_PATH.exists():
    print(f"ERROR: missing credentials.json at {CREDS_PATH}")
    print(
        "Download a Desktop OAuth client from Google Cloud Console "
        "(APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID "
        "→ Desktop app), save the downloaded JSON as backend/credentials.json, "
        "then re-run."
    )
    sys.exit(1)

# Force a fresh consent flow — refresh path would hand back the existing
# (narrower) grant. A stale token.json on disk would also short-circuit
# the upstream _get_creds(), so we remove it before opening the flow.
if TOKEN_PATH.exists():
    TOKEN_PATH.unlink()

print("Running OAuth flow with broader scopes (calendar.events + read + sheets + drive)...")
print("A browser window will open. Sign in with the Google account that owns your calendars.")
print()

flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), BROADER_SCOPES)
creds = flow.run_local_server(port=0)
TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
token_json = TOKEN_PATH.read_text(encoding="utf-8")

print()
print("=" * 60)
print("SUCCESS. Copy the JSON below and paste it into the admin UI:")
print("  Admin → Settings → Advanced Settings → Google Calendar → Update Token")
print("=" * 60)
print(token_json)
print("=" * 60)
