import traceback

from fastapi import APIRouter, Depends, File, Form, UploadFile

from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.models.user import User
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
    _: User = Depends(get_current_user),
):
    data = await file.read()
    filename = f"{photo_id}_{file.filename or 'photo.jpg'}"

    try:
        result = upload_photo_to_drive(
            db=db,
            file_data=data,
            filename=filename,
            mime_type=file.content_type or "image/jpeg",
            job_name=job_name,
            job_date=job_date,
        )
    except Exception as e:
        traceback.print_exc()
        return {
            "ok": False,
            "photo_id": photo_id,
            "error": str(e),
        }

    return {
        "ok": True,
        "photo_id": photo_id,
        "drive_file_id": result["file_id"],
        "drive_url": result["url"],
    }
