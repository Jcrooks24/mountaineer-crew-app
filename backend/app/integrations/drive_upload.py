import os
from io import BytesIO
from typing import Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.google_cal_oauth import _get_creds

PARENT_FOLDER_KEY = "drive_parent_folder_id"
DEFAULT_PARENT_FOLDER_NAME = "Mountaineer Crew Photos"


def _get_or_create_folder(svc, name: str, parent_id: Optional[str] = None) -> str:
    """Find a Drive folder by name (optionally inside a parent), create it if missing."""
    q = (
        f"name='{name}' and mimeType='application/vnd.google-apps.folder'"
        f" and trashed=false"
    )
    if parent_id:
        q += f" and '{parent_id}' in parents"

    resp = svc.files().list(q=q, fields="files(id)", spaces="drive").execute()
    files = resp.get("files", [])
    if files:
        return files[0]["id"]

    meta: dict = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        meta["parents"] = [parent_id]

    folder = svc.files().create(body=meta, fields="id").execute()
    return folder["id"]


def _get_parent_folder_id(svc, db: Optional[Session]) -> str:
    folder_name = os.getenv("DRIVE_PARENT_FOLDER_NAME", DEFAULT_PARENT_FOLDER_NAME).strip()

    # Cache in system_config so we don't search Drive on every upload
    if db:
        row = db.execute(
            text("SELECT value FROM system_config WHERE key = :key"),
            {"key": PARENT_FOLDER_KEY},
        ).fetchone()
        if row and row[0]:
            return row[0]

    folder_id = _get_or_create_folder(svc, folder_name)

    if db:
        db.execute(
            text(
                "INSERT INTO system_config(key, value) VALUES(:key, :val) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ),
            {"key": PARENT_FOLDER_KEY, "val": folder_id},
        )
        db.commit()

    return folder_id


def upload_photo_to_drive(
    db: Session,
    file_data: bytes,
    filename: str,
    mime_type: str,
    job_name: str,
    job_date: str,
) -> dict:
    """
    Upload a photo to Google Drive:
      <parent folder> / <job_name> - <job_date> / <filename>

    Job folder is created on first upload only (no empty folders).
    Returns {"file_id": "...", "url": "..."}.
    """
    creds = _get_creds(db)
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)

    parent_id = _get_parent_folder_id(svc, db)

    safe_name = (job_name or "Unknown Job").replace("/", "-").strip()
    safe_date = (job_date or "").strip()
    folder_label = f"{safe_name} - {safe_date}" if safe_date else safe_name
    folder_label = folder_label[:100]

    job_folder_id = _get_or_create_folder(svc, folder_label, parent_id)

    media = MediaIoBaseUpload(BytesIO(file_data), mimetype=mime_type, resumable=False)
    result = svc.files().create(
        body={"name": filename, "parents": [job_folder_id]},
        media_body=media,
        fields="id, webViewLink",
    ).execute()

    return {
        "file_id": result["id"],
        "url": result.get("webViewLink", ""),
    }
