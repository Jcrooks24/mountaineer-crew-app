import traceback

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.models.user import User
from app.db.models.photo import Photo
from app.db.session import get_db
from app.integrations.drive_upload import upload_photo_to_drive

router = APIRouter(prefix="/api/photos", tags=["photos"])


@router.post("/upload")
async def upload_photo(
    file: UploadFile = File(...),
    photo_id: str = Form(...),
    job_uuid: str = Form(...),
    job_name: str = Form(default=""),
    job_date: str = Form(default=""),
    caption: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = await file.read()
    mime_type = file.content_type or "image/jpeg"

    try:
        result = upload_photo_to_drive(
            db=db,
            file_data=data,
            filename=photo_id,
            mime_type=mime_type,
            job_name=job_name,
            job_date=job_date,
            caption=caption,
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
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # duplicate photo_id — already uploaded

    return {
        "ok": True,
        "photo_id": photo_id,
        "drive_file_id": result["file_id"],
        "drive_url": result["url"],
        "thumb_url": result["thumb_url"],
    }


@router.get("")
def get_photos(
    job_uuid: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return all photos for a job, newest first. Used to sync photos across devices."""
    rows = (
        db.query(Photo)
        .filter(Photo.job_uuid == job_uuid)
        .order_by(Photo.created_at.desc())
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
            }
            for r in rows
        ],
    }
