import os
import re
from typing import BinaryIO, Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.google_cal_oauth import _get_creds, _build_authorized_http

# 8 MB resumable chunks — keeps peak RSS bounded per upload regardless
# of total file size. googleapiclient's default is 100 MB, which on a
# 512 MB / even 2 GB Render worker still OOMs on bigger documents.
DRIVE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024


def _execute_resumable(request):
    response = None
    while response is None:
        _, response = request.next_chunk()
    return response

PARENT_FOLDER_KEY = "drive_parent_folder_id"
DEFAULT_PARENT_FOLDER_NAME = "Mountaineer Crew Photos"

# Estimator photos land in a separate top-level folder so the crew-job
# parent stays clean. Set DRIVE_ESTIMATOR_PARENT_FOLDER_ID on the Render
# service to the ID of the target Drive folder (grab it from the folder's
# URL — the bit between /folders/ and any ?query).
ESTIMATOR_PARENT_ENV_VAR = "DRIVE_ESTIMATOR_PARENT_FOLDER_ID"

# Reimbursement photos (odometer + receipts) land in their own folder so
# admin can audit them separately from job photos. Falls back to the
# default crew-photos parent if the env var isn't set.
REIMBURSEMENT_PARENT_ENV_VAR = "DRIVE_REIMBURSEMENT_PARENT_FOLDER_ID"

_cached_drive_service = None


def _get_drive_service(db=None):
    global _cached_drive_service
    if _cached_drive_service is not None:
        return _cached_drive_service
    # Use certifi-backed http to avoid SSL errors on Render
    authorized_http = _build_authorized_http(_get_creds(db))
    _cached_drive_service = build("drive", "v3", http=authorized_http, cache_discovery=False)
    return _cached_drive_service


def _safe(s: str) -> str:
    """Strip characters that break Drive filenames or query strings."""
    s = s.replace("'", "\\'")   # escape single quotes in query
    return re.sub(r'[\\/:*?"<>|]', "-", s).strip()


def _get_or_create_folder(svc, name: str, parent_id: Optional[str] = None) -> str:
    """Find a Drive folder by name (optionally inside a parent), create if missing."""
    escaped = name.replace("'", "\\'")
    q = (
        f"name='{escaped}' and mimeType='application/vnd.google-apps.folder'"
        f" and trashed=false"
    )
    if parent_id:
        q += f" and '{parent_id}' in parents"

    resp = svc.files().list(q=q, fields="files(id)", spaces="drive").execute()
    files = resp.get("files", [])
    if files:
        print(f"[drive] found existing folder '{name}' → {files[0]['id']}")
        return files[0]["id"]

    meta: dict = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    if parent_id:
        meta["parents"] = [parent_id]

    folder = svc.files().create(body=meta, fields="id").execute()
    print(f"[drive] created folder '{name}' → {folder['id']}")
    return folder["id"]


def _get_parent_folder_id(svc, db: Optional[Session]) -> str:
    folder_name = os.getenv("DRIVE_PARENT_FOLDER_NAME", DEFAULT_PARENT_FOLDER_NAME).strip()

    # Cache in system_config to avoid repeated Drive searches
    if db:
        row = db.execute(
            text("SELECT value FROM system_config WHERE key = :key"),
            {"key": PARENT_FOLDER_KEY},
        ).fetchone()
        if row and row[0]:
            print(f"[drive] using cached parent folder id: {row[0]}")
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
    file_obj: BinaryIO,
    filename: str,
    mime_type: str,
    job_name: str,
    job_date: str,
    caption: str = "",
    is_estimator: bool = False,
) -> dict:
    """
    Upload a photo to Google Drive:
      <parent folder> / <job_name> - <job_date> / <job_name> - <job_date> - <short_id>.jpg

    When `is_estimator` is True and DRIVE_ESTIMATOR_PARENT_FOLDER_ID is set
    on the environment, the photo lands under that folder instead of the
    default crew-photos parent. Falls back to the default parent if the
    env var is missing (so photos never fail the upload just because the
    admin forgot to wire it).

    Folder created on first upload only. Caption stored as Drive file description.
    Returns {"file_id": "...", "url": "..."}.
    """
    svc = _get_drive_service(db)

    if is_estimator:
        estimator_parent = os.getenv(ESTIMATOR_PARENT_ENV_VAR, "").strip()
        parent_id = estimator_parent or _get_parent_folder_id(svc, db)
        if not estimator_parent:
            print(
                f"[drive] {ESTIMATOR_PARENT_ENV_VAR} not set — estimator photo landing "
                f"in default crew-photos parent instead"
            )
    else:
        parent_id = _get_parent_folder_id(svc, db)

    safe_name = _safe(job_name or "Unknown Job")
    safe_date = (job_date or "").strip()
    folder_label = f"{safe_name} - {safe_date}" if safe_date else safe_name
    folder_label = folder_label[:100]

    print(f"[drive] job_name={job_name!r} job_date={job_date!r} folder={folder_label!r}")

    job_folder_id = _get_or_create_folder(svc, folder_label, parent_id)

    # Build a human-readable filename: "Job Name - YYYY-MM-DD - abc12345.jpg"
    ext = mime_type.split("/")[-1] if "/" in mime_type else "jpg"
    ext = ext if ext in ("jpg", "jpeg", "png", "heic", "webp") else "jpg"
    short_id = filename[:8] if filename else "photo"  # first 8 chars of photo_id
    drive_filename = f"{safe_name} - {safe_date} - {short_id}.{ext}" if safe_date \
                     else f"{safe_name} - {short_id}.{ext}"

    print(f"[drive] uploading as '{drive_filename}' into folder '{folder_label}'")

    file_obj.seek(0)
    media = MediaIoBaseUpload(
        file_obj,
        mimetype=mime_type,
        resumable=True,
        chunksize=DRIVE_UPLOAD_CHUNK_SIZE,
    )
    request = svc.files().create(
        body={
            "name": drive_filename,
            "parents": [job_folder_id],
            "description": caption or "",
        },
        media_body=media,
        fields="id, webViewLink",
    )
    result = _execute_resumable(request)

    file_id = result["id"]

    # Make file publicly viewable so any crew member can see it without Google login
    svc.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()

    return {
        "file_id": file_id,
        "url": result.get("webViewLink", ""),
        "thumb_url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w800",
    }


# ── Reimbursement photo uploader ─────────────────────────────────────────────

def upload_reimbursement_photo_to_drive(
    db: Session,
    file_obj: BinaryIO,
    filename: str,
    mime_type: str,
    user_name: str,
    reimbursement_uuid: str,
    kind: str,           # "odo_start" | "odo_end" | "receipt"
    caption: str = "",
) -> dict:
    """Upload a reimbursement photo to Drive.

    Base location is the reimbursement parent folder
    (DRIVE_REIMBURSEMENT_PARENT_FOLDER_ID, or the default crew-photos
    parent if unset).

    - Receipt photos (kind="receipt") land directly in that parent — a
      receipt is a single photo per submission, so no folder is needed.
    - Odometer photos (kind="odo_start"/"odo_end") go into a per-submission
      subfolder, since a mileage request has two photos that belong
      together. Both photos of one submission share the same folder
      (keyed on reimbursement_uuid).

    `kind` is written into the filename so the admin can tell what they're
    looking at at a glance.
    """
    svc = _get_drive_service(db)

    reimb_parent = os.getenv(REIMBURSEMENT_PARENT_ENV_VAR, "").strip()
    parent_id = reimb_parent or _get_parent_folder_id(svc, db)
    if not reimb_parent:
        print(
            f"[drive] {REIMBURSEMENT_PARENT_ENV_VAR} not set — reimbursement photo "
            f"landing in default crew-photos parent instead"
        )

    ext = mime_type.split("/")[-1] if "/" in mime_type else "jpg"
    ext = ext if ext in ("jpg", "jpeg", "png", "heic", "webp") else "jpg"
    short_id = (reimbursement_uuid or filename or "photo")[:8]
    safe_user = _safe(user_name or "Unknown")

    # Odometer photos come in pairs — group each submission's two photos in
    # their own folder. Receipts are single, so they stay flat in the parent.
    if kind in ("odo_start", "odo_end"):
        folder_label = f"{safe_user} - Mileage - {short_id}"[:100]
        target_folder_id = _get_or_create_folder(svc, folder_label, parent_id)
    else:
        target_folder_id = parent_id

    # Filename carries the context regardless of where the file lands.
    drive_filename = f"{safe_user} - {kind} - {short_id}.{ext}"

    print(f"[drive] uploading reimbursement '{drive_filename}'")

    file_obj.seek(0)
    media = MediaIoBaseUpload(
        file_obj,
        mimetype=mime_type,
        resumable=True,
        chunksize=DRIVE_UPLOAD_CHUNK_SIZE,
    )
    request = svc.files().create(
        body={
            "name": drive_filename,
            "parents": [target_folder_id],
            "description": caption or "",
        },
        media_body=media,
        fields="id, webViewLink",
    )
    result = _execute_resumable(request)
    file_id = result["id"]

    svc.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()

    return {
        "file_id": file_id,
        "url": result.get("webViewLink", ""),
        "thumb_url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w800",
    }


# ── Generic uploader for the Document Library and other non-photo files ──────

DOCUMENTS_PARENT_KEY = "drive_documents_folder_id"
DEFAULT_DOCUMENTS_FOLDER_NAME = "Mountaineer Crew Documents"


def _get_documents_folder_id(svc, db: Optional[Session]) -> str:
    folder_name = os.getenv(
        "DRIVE_DOCUMENTS_FOLDER_NAME", DEFAULT_DOCUMENTS_FOLDER_NAME
    ).strip()

    if db:
        row = db.execute(
            text("SELECT value FROM system_config WHERE key = :key"),
            {"key": DOCUMENTS_PARENT_KEY},
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
            {"key": DOCUMENTS_PARENT_KEY, "val": folder_id},
        )
        db.commit()

    return folder_id


def upload_file_to_drive(
    db: Session,
    file_obj: BinaryIO,
    filename: str,
    mime_type: str,
    category: str = "general",
) -> dict:
    """Upload an arbitrary file to the Mountaineer Crew Documents folder,
    organized by category subfolder. Publicly readable."""
    svc = _get_drive_service(db)
    parent_id = _get_documents_folder_id(svc, db)

    safe_category = _safe(category or "general")[:80] or "general"
    category_folder = _get_or_create_folder(svc, safe_category, parent_id)

    safe_filename = _safe(filename)[:160] or "document"

    file_obj.seek(0)
    media = MediaIoBaseUpload(
        file_obj,
        mimetype=mime_type,
        resumable=True,
        chunksize=DRIVE_UPLOAD_CHUNK_SIZE,
    )
    request = svc.files().create(
        body={
            "name": safe_filename,
            "parents": [category_folder],
        },
        media_body=media,
        fields="id, webViewLink",
    )
    result = _execute_resumable(request)

    file_id = result["id"]

    svc.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()

    return {
        "file_id": file_id,
        "url": result.get("webViewLink", ""),
    }


def delete_drive_file(db: Session, file_id: str) -> None:
    svc = _get_drive_service(db)
    svc.files().delete(fileId=file_id).execute()
