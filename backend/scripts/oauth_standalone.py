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
]

BASE_DIR = Path(__file__).resolve().parents[1]
CREDS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

if not CREDS_PATH.exists():
    print(f"ERROR: credentials.json not found at {CREDS_PATH}")
    sys.exit(1)

print("Opening browser for Google sign-in...\n")
flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_PATH), SCOPES)
creds = flow.run_local_server(port=0)

token_json = creds.to_json()
TOKEN_PATH.write_text(token_json, encoding="utf-8")

print("=" * 60)
print("SUCCESS. Paste the JSON below into Admin > Calendar in the app:")
print("=" * 60)
print(token_json)
print("=" * 60)
