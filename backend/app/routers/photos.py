import traceback

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.models.user import User
from app.db.models.photo import Photo
from app.db.session import get_db
from app.integrations.drive_upload import (
    update_drive_file_description,
    upload_photo_to_drive,
)

router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.post("/upload")
def upload_photo(
    file: UploadFile = File(...),
    photo_id: str = Form(...),
    job_uuid: str = Form(...),
    job_name: str = Form(default=""),
    job_date: str = Form(default=""),
    caption: str = Form(default=""),
    folder: str = Form(default=""),  # "estimator" routes to the estimator parent folder
    incident_uuid: str = Form(default=""),  # tags this photo to an incident
    claim_number: str = Form(default=""),   # denormalized for display / Drive search
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mime_type = file.content_type or "image/jpeg"

    incident_uuid = (incident_uuid or "").strip()
    claim_number = (claim_number or "").strip()
    # Prefix the Drive caption with the claim number so an incident's photos are
    # findable in Drive by claim, mirroring the incident's claim_number in the
    # sheet. The DB fields below are the primary link; this is admin convenience.
    drive_caption = f"[{claim_number}] {caption}".strip() if claim_number else caption

    # Idempotent: if this photo_id is already stored, skip the Drive upload
    # and return the existing record. The offline queue retries with the same
    # photo_id, and Drive uploads are NOT idempotent - re-uploading would
    # orphan a duplicate public file.
    existing = db.query(Photo).filter(Photo.id == photo_id).first()
    if existing:
        return {
            "ok": True,
            "photo_id": photo_id,
            "drive_file_id": existing.drive_file_id,
            "drive_url": existing.drive_url,
            "thumb_url": f"https://drive.google.com/thumbnail?id={existing.drive_file_id}&sz=w800",
        }

    try:
        result = upload_photo_to_drive(
            db=db,
            file_obj=file.file,
            filename=photo_id,
            mime_type=mime_type,
            job_name=job_name,
            job_date=job_date,
            caption=drive_caption,
            is_estimator=(folder.strip().lower() == "estimator"),
        )
    except Exception as e:
        traceback.print_exc()
        return {"ok": False, "photo_id": photo_id, "error": str(e)}

    # Save metadata to DB so other devices can fetch it
    row = Photo(
        id=photo_id,
        job_uuid=job_uuid,
        created_by=current_user.name or current_user.email or "",
        caption=caption,
        drive_file_id=result["file_id"],
        drive_url=result["url"],
        mime_type=mime_type,
        incident_uuid=incident_uuid or None,
        claim_number=claim_number or None,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # raced a concurrent upload of the same photo_id
    except SQLAlchemyError:
        # Non-duplicate DB failure (connection blip, etc.). Return ok=false so
        # the client keeps the photo queued and retries, instead of a 500.
        db.rollback()
        traceback.print_exc()
        return {"ok": False, "photo_id": photo_id, "error": "Failed to save photo record"}

    return {
        "ok": True,
        "photo_id": photo_id,
        "drive_file_id": result["file_id"],
        "drive_url": result["url"],
        "thumb_url": result["thumb_url"],
    }


class CaptionUpdate(BaseModel):
    photo_id: str
    caption: str = ""


@router.post("/caption")
def update_caption(
    payload: CaptionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Update a photo's caption/note after it was submitted. Lets the crew add
    or edit a note on an individual photo from the Saved gallery. Persists to
    the DB (so it syncs across devices) and best-effort mirrors it onto the
    Drive file description so admin sees the note in Drive too."""
    row = db.query(Photo).filter(Photo.id == payload.photo_id).first()
    if not row:
        return {"ok": False, "error": "Photo not found"}

    caption = (payload.caption or "").strip()
    row.caption = caption
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        traceback.print_exc()
        return {"ok": False, "error": "Failed to save note"}

    # Best-effort: keep the Drive description in sync. Never fail the request
    # on a Drive hiccup - the note is already saved to the DB.
    if row.drive_file_id:
        try:
            update_drive_file_description(db, row.drive_file_id, caption)
        except Exception:
            traceback.print_exc()

    return {"ok": True, "photo_id": payload.photo_id, "caption": caption}


@router.get("")
def get_photos(
    job_uuid: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return all photos for a job, newest first. Used to sync photos across devices."""
    # Cap per-job photo pull. Most jobs have <20 photos; 500 is generous and
    # keeps the response bounded if a job's photo count ever drifts large.
    rows = (
        db.query(Photo)
        .filter(Photo.job_uuid == job_uuid)
        .order_by(Photo.created_at.desc())
        .limit(500)
        .all()
    )
    return {
        "ok": True,
        "photos": [
            {
                "id": r.id,
                "job_uuid": r.job_uuid,
                "created_by": r.created_by,
                "caption": r.caption,
                "drive_file_id": r.drive_file_id,
                "drive_url": r.drive_url,
                "thumb_url": f"https://drive.google.com/thumbnail?id={r.drive_file_id}&sz=w800",
                "created_at": r.created_at.isoformat(),
                "mime_type": r.mime_type,
                "incident_uuid": r.incident_uuid,
                "claim_number": r.claim_number,
            }
            for r in rows
        ],
    }
