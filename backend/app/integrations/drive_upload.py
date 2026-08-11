import os
import re
import threading
from typing import Any, BinaryIO, Optional

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.google_cal_oauth import _get_creds, _build_authorized_http

# 8 MB resumable chunks - keeps peak RSS bounded per upload regardless
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
# URL - the bit between /folders/ and any ?query).
ESTIMATOR_PARENT_ENV_VAR = "DRIVE_ESTIMATOR_PARENT_FOLDER_ID"

# Reimbursement photos (odometer + receipts) land in their own folder so
# admin can audit them separately from job photos. Falls back to the
# default crew-photos parent if the env var isn't set.
REIMBURSEMENT_PARENT_ENV_VAR = "DRIVE_REIMBURSEMENT_PARENT_FOLDER_ID"

# The Drive service wraps an httplib2 Http, whose pooled TLS socket is NOT
# thread-safe under OpenSSL. Photo/PDF uploads run on FastAPI's request
# threadpool, so a single process-wide service shared across concurrent uploads
# routes them through one socket and corrupts it (SSL errors, and on Render this
# has crashed the worker). Cache it per-thread instead - the exact pattern
# sheets_export._get_sheets_svc uses - with a version counter so an admin token
# rotation forces every thread to rebuild on next use.
_drive_svc_threadlocal = threading.local()
_drive_svc_version: int = 0
_drive_svc_version_lock = threading.Lock()


def _get_drive_service(db=None) -> Any:
    cached = getattr(_drive_svc_threadlocal, "svc", None)
    cached_version = getattr(_drive_svc_threadlocal, "version", -1)
    if cached is not None and cached_version == _drive_svc_version:
        return cached
    # Use certifi-backed http to avoid SSL errors on Render
    authorized_http = _build_authorized_http(_get_creds(db))
    svc = build("drive", "v3", http=authorized_http, cache_discovery=False)
    _drive_svc_threadlocal.svc = svc
    _drive_svc_threadlocal.version = _drive_svc_version
    return svc


def invalidate_drive_svc_cache() -> None:
    """Force every thread to rebuild its cached Drive svc on next use. Called on
    OAuth token rotation. We can't reach into another thread's threading.local,
    so bump a version counter each cached svc compares against."""
    global _drive_svc_version
    with _drive_svc_version_lock:
        _drive_svc_version += 1


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
                f"[drive] {ESTIMATOR_PARENT_ENV_VAR} not set - estimator photo landing "
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

    - Receipt photos (kind="receipt") land directly in that parent - a
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
            f"[drive] {REIMBURSEMENT_PARENT_ENV_VAR} not set - reimbursement photo "
            f"landing in default crew-photos parent instead"
        )

    ext = mime_type.split("/")[-1] if "/" in mime_type else "jpg"
    ext = ext if ext in ("jpg", "jpeg", "png", "heic", "webp") else "jpg"
    short_id = (reimbursement_uuid or filename or "photo")[:8]
    safe_user = _safe(user_name or "Unknown")

    # Odometer photos come in pairs - group each submission's two photos in
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
        # Link to the folder the photo landed in. For odometer photos this
        # is the per-submission folder holding both photos; for receipts it
        # is the parent reimbursement folder.
        "folder_url": f"https://drive.google.com/drive/folders/{target_folder_id}",
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


# ── Signed Bill of Lading PDF uploader ───────────────────────────────────────

BOL_FOLDER_KEY = "drive_bol_folder_id"
# Preferred: a Drive folder ID (matches DRIVE_ESTIMATOR_PARENT_FOLDER_ID /
# DRIVE_REIMBURSEMENT_PARENT_FOLDER_ID). An ID points staging and production at
# DIFFERENT physical folders, so staging can never write into - or overwrite in
# place - the real signed-BOL documents. Grab it from the folder URL (the segment
# after /folders/). See docs/CREDENTIALS.md and .env.staging.example.
BOL_FOLDER_ID_ENV_VAR = "DRIVE_BOL_FOLDER_ID"
DEFAULT_BOL_FOLDER_NAME = "Signed Bills of Lading"


def _get_bol_folder_id(svc, db: Optional[Session]) -> str:
    """Resolve the dedicated top-level folder for signed BOL PDFs.

    Prefer DRIVE_BOL_FOLDER_ID (an explicit folder ID) - the reliable way to keep
    staging and prod on separate folders. Fall back to the LEGACY name-based
    lookup (DRIVE_BOL_FOLDER_NAME / the default) only when the ID is unset, kept
    for backward compatibility. The name-based path resolves by folder NAME, so
    two environments with the same folder name resolve the SAME real folder -
    which let staging overwrite production BOLs. Always set the ID."""
    folder_id_env = os.getenv(BOL_FOLDER_ID_ENV_VAR, "").strip()
    if folder_id_env:
        return folder_id_env

    folder_name = os.getenv("DRIVE_BOL_FOLDER_NAME", DEFAULT_BOL_FOLDER_NAME).strip() or DEFAULT_BOL_FOLDER_NAME

    if db:
        row = db.execute(
            text("SELECT value FROM system_config WHERE key = :key"),
            {"key": BOL_FOLDER_KEY},
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
            {"key": BOL_FOLDER_KEY, "val": folder_id},
        )
        db.commit()

    return folder_id


# ── Driver Qualification (DQ) files ───────────────────────────────────────────
# DQ documents are DOT compliance records and carry PII (medical cards,
# employment applications). They live in their own top-level folder, one
# subfolder per driver, so the office can hand an auditor a single driver's
# folder without exposing anyone else's.
#
# ID-only on purpose. There is NO name-based fallback here, unlike BOL: a name
# fallback is what let staging and prod resolve the same physical folder, and
# these are the documents where that matters most. If the env var is unset we
# fall back to the previous behavior (the Documents folder) rather than invent a
# folder, so an unset var degrades to the old layout instead of scattering PII
# somewhere new.
DQ_FOLDER_ID_ENV_VAR = "DRIVE_DQ_FOLDER_ID"


def _dq_parent_folder_id(svc, db: Optional[Session]) -> str:
    """Top-level folder that holds the per-driver DQ subfolders."""
    folder_id_env = os.getenv(DQ_FOLDER_ID_ENV_VAR, "").strip()
    if folder_id_env:
        return folder_id_env
    # Unset: keep the pre-existing behavior so uploads never fail closed.
    return _get_documents_folder_id(svc, db)


def sweep_dq_orphans(db: Session, folder_id: str, doc_type: str, keep_file_id: str) -> int:
    """Delete leftover files of this doc type in the driver's folder, keeping one.

    The upload writes to Drive BEFORE the Postgres row is committed. A `kill -9`
    between the two (Render recycles workers and this app has OOM history)
    leaves a file no row points at: the app still says the document is missing,
    the driver uploads again, and the orphan sits there forever because the
    most-recent-wins delete keys off a row that never existed.

    A handled failure is compensated at the call site. This covers the case that
    cannot be compensated, by self-healing on the NEXT successful upload of the
    same doc type: anything sharing the `<doc_type>__` prefix that is not the
    file we just committed is a leftover, so drop it.

    Best-effort by design. Never raise: the document is already safely stored and
    recorded, and failing the request over tidy-up would be the worse trade.
    """
    if not (folder_id and doc_type and keep_file_id):
        return 0
    removed = 0
    try:
        svc = _get_drive_service(db)
        prefix = f"{_safe(doc_type)[:40]}__"
        escaped = prefix.replace("'", "\\'")
        resp = svc.files().list(
            q=(
                f"'{folder_id}' in parents and trashed=false"
                f" and name contains '{escaped}'"
                f" and mimeType != 'application/vnd.google-apps.folder'"
            ),
            fields="files(id, name)",
            spaces="drive",
        ).execute()
        for f in resp.get("files", []):
            # `contains` is a substring match, so confirm it is really our prefix
            # before deleting anything.
            if f["id"] == keep_file_id or not str(f.get("name", "")).startswith(prefix):
                continue
            try:
                delete_drive_file(db, f["id"])
                removed += 1
                print(f"[dq] swept orphaned {doc_type} file {f['id']} ({f.get('name')})")
            except Exception as exc:  # noqa: BLE001
                print(f"[dq] orphan sweep could not delete {f['id']}: {exc}")
    except Exception as exc:  # noqa: BLE001
        print(f"[dq] orphan sweep failed in folder {folder_id}: {exc}")
    return removed


def upload_dq_file_to_drive(
    db: Session,
    file_obj: BinaryIO,
    filename: str,
    mime_type: str,
    driver_folder_name: str,
    known_folder_id: Optional[str] = None,
    doc_type: str = "",
) -> dict:
    """Upload one DQ document into the driver's own subfolder.

    `known_folder_id` is the folder we already created for this driver on a
    previous submission. Passing it is what makes a rename safe: the folder is
    addressed by ID, so a driver who changes their name keeps ONE compliance
    file instead of silently starting a second folder under the new name. It
    also skips a Drive list call per upload.

    Returns the usual file_id/url plus `folder_id`, which the caller is expected
    to persist against the driver.
    """
    svc = _get_drive_service(db)

    folder_id = known_folder_id
    if folder_id:
        # Confirm it still exists and is not trashed - a folder deleted by hand
        # in Drive would otherwise make every future upload fail.
        try:
            meta = svc.files().get(fileId=folder_id, fields="id, trashed").execute()
            if meta.get("trashed"):
                folder_id = None
        except Exception as exc:
            print(f"[dq] stored folder {folder_id} unusable, recreating: {exc}")
            folder_id = None

    if not folder_id:
        parent_id = _dq_parent_folder_id(svc, db)
        safe_name = _safe(driver_folder_name or "")[:80] or "Unnamed Driver"
        folder_id = _get_or_create_folder(svc, safe_name, parent_id)

    # Prefix with the doc type so the file is identifiable in the folder by an
    # auditor AND by us: sweep_dq_orphans below uses it to recognize leftovers
    # from a crashed upload of this same document type.
    prefix = f"{_safe(doc_type)[:40]}__" if doc_type else ""
    safe_filename = prefix + (_safe(filename)[:160] or "document")

    file_obj.seek(0)
    media = MediaIoBaseUpload(
        file_obj,
        mimetype=mime_type,
        resumable=True,
        chunksize=DRIVE_UPLOAD_CHUNK_SIZE,
    )
    request = svc.files().create(
        body={"name": safe_filename, "parents": [folder_id]},
        media_body=media,
        fields="id, webViewLink",
    )
    result = _execute_resumable(request)

    # Anyone-with-the-link reader, matching upload_file_to_drive and preserving
    # how DQ files behaved before this folder change.
    #
    # This is NOT ideal and is deliberately left alone here: the frontend links
    # straight to webViewLink (DqFilesTab.tsx:173, DqMyFileCard.tsx:126), so a
    # driver opening their own medical card needs the link to work without a
    # Google account. Tightening it means proxying downloads through the
    # authenticated backend, which is a separate change with its own UX and ADR.
    # Doing it silently here would break every driver's "view" link.
    # Tracked in docs/RUNBOOKS.md Known defects.
    svc.permissions().create(
        fileId=result["id"],
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()

    return {
        "file_id": result["id"],
        "url": result.get("webViewLink", ""),
        "folder_id": folder_id,
    }


def _pdf_media(file_obj: BinaryIO) -> MediaIoBaseUpload:
    file_obj.seek(0)
    return MediaIoBaseUpload(
        file_obj,
        mimetype="application/pdf",
        resumable=True,
        chunksize=DRIVE_UPLOAD_CHUNK_SIZE,
    )


def upload_bol_pdf_to_drive(
    db: Session,
    file_obj: BinaryIO,
    job_name: str,
    job_date: str,
    existing_file_id: Optional[str] = None,
) -> dict:
    """Upload a signed Bill of Lading PDF to its own top-level Drive folder,
    named "<job_date> - <job_name>.pdf" (date first, per the spec). Publicly
    readable so the office can open it from the Sheet link without a login.

    If `existing_file_id` is given (the BOL already has a stored PDF - e.g. the
    origin/pre-delivery copy), the file's CONTENT is replaced in place so the
    completed document supersedes the earlier one instead of leaving two files.
    The Drive file id and link stay stable. Falls back to creating a new file
    if the existing one is gone (deleted/trashed).

    Returns {"file_id": "...", "url": "..."}."""
    svc = _get_drive_service(db)

    safe_name = _safe(job_name or "Unknown Job")
    safe_date = (job_date or "").strip()
    base = f"{safe_date} - {safe_name}" if safe_date else safe_name
    drive_filename = (base[:150] or "Bill of Lading") + ".pdf"

    # Replace the existing file's content in place when we have one.
    if existing_file_id:
        try:
            print(f"[drive] replacing signed BOL '{drive_filename}' (file {existing_file_id})")
            request = svc.files().update(
                fileId=existing_file_id,
                body={"name": drive_filename},
                media_body=_pdf_media(file_obj),
                fields="id, webViewLink",
            )
            result = _execute_resumable(request)
            return {"file_id": result["id"], "url": result.get("webViewLink", "")}
        except Exception as e:
            # Old file gone/untouchable - create a fresh one below.
            print(f"[drive] BOL pdf replace failed ({existing_file_id}); creating new: {e}")

    parent_id = _get_bol_folder_id(svc, db)
    print(f"[drive] uploading signed BOL '{drive_filename}'")
    request = svc.files().create(
        body={"name": drive_filename, "parents": [parent_id]},
        media_body=_pdf_media(file_obj),
        fields="id, webViewLink",
    )
    result = _execute_resumable(request)
    file_id = result["id"]

    svc.permissions().create(
        fileId=file_id,
        body={"type": "anyone", "role": "reader"},
        fields="id",
    ).execute()

    return {"file_id": file_id, "url": result.get("webViewLink", "")}


def delete_drive_file(db: Session, file_id: str) -> None:
    svc = _get_drive_service(db)
    svc.files().delete(fileId=file_id).execute()


def update_drive_file_description(db: Session, file_id: str, description: str) -> None:
    """Update a Drive file's description in place - used to keep a photo's
    caption/note in sync on Drive after the crew edits it in-app. Raises on a
    hard Drive error; callers treat it as best-effort."""
    svc = _get_drive_service(db)
    svc.files().update(
        fileId=file_id,
        body={"description": description or ""},
        fields="id",
    ).execute()
