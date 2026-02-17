from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

SPREADSHEET_ID = "17RMNRlBvHxYo-sDPoHO3wSajulVANXbN5rfWLWVA4bs"
TAB = "Events"

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]

def main():
    creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)

    row = [
        "smoke-test-event-id",
        "2026-02-15T00:00:00Z",
        "smoke-test-job-uuid",
        "Smoke Test Job",
        "2026-02-15",
        "SMOKE_TEST",
        "hello sheets",
        "45.0",
        "-111.0",
        "10",
        "dev-test",
        "synced",
    ]

    svc.spreadsheets().values().append(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{TAB}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()

    print("✅ appended 1 row to Events tab")

if __name__ == "__main__":
    main()
