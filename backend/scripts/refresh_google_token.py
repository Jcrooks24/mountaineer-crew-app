"""
Run this locally to refresh the Google OAuth token and print the new JSON
to paste into the GOOGLE_OAUTH_TOKEN_JSON env var on Render.

Usage:
    cd backend
    python scripts/refresh_google_token.py
"""
import json
import sys
from pathlib import Path

# Add backend/ to path so app imports work
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.google_cal_oauth import _get_creds

print("Running OAuth flow (a browser window will open)...\n")
creds = _get_creds()

token_path = Path(__file__).resolve().parents[1] / "token.json"
token_json = token_path.read_text(encoding="utf-8")

print("=" * 60)
print("SUCCESS. Copy the value below into GOOGLE_OAUTH_TOKEN_JSON on Render:")
print("=" * 60)
print(token_json)
print("=" * 60)
