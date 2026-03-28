"""
Standalone OAuth flow — no app imports, works with Python 3.14.
Run from the backend directory:
    python scripts/oauth_standalone.py

Requires only:
    pip install google-auth-oauthlib
"""
import json
import sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("Missing dependency. Run:")
    print("  .venv\\Scripts\\pip install google-auth-oauthlib")
    sys.exit(1)

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

BASE_DIR = Path(__file__).resolve().parents[1]
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

if not CREDS_PATH.exists():
    print(f"ERROR: credentials.json not found at {CREDS_PATH}")
    sys.exit(1)

print("Opening browser for Google sign-in...")
print("NOTE: Select your Google account and click 'Allow' even if it says")
print("      'already authorized' — this forces a new refresh token.\n")

flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)

# prompt=consent forces Google to issue a new refresh_token every time.
# access_type=offline is required to get a refresh_token at all.
# Without these, re-authorization returns only an access_token (expires in 1h)
# and the app would need manual re-auth every hour.
creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

token_data = json.loads(creds.to_json())

if not token_data.get("refresh_token"):
    print("\nWARNING: No refresh_token in the result. The token will expire in ~1 hour.")
    print("To fix: go to https://myaccount.google.com/permissions, revoke access for")
    print("this app, then re-run this script.\n")
else:
    print("\nrefresh_token confirmed present — this token will auto-renew forever.\n")

token_json = json.dumps(token_data, indent=2)
TOKEN_PATH.write_text(token_json, encoding="utf-8")

print("=" * 60)
print("SUCCESS. Paste the JSON below into Admin > Calendar in the app:")
print("=" * 60)
print(token_json)
print("=" * 60)
