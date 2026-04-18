from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: int
    title: str
    category: str
    filename: str
    mime_type: str
    drive_file_id: str
    drive_url: str
    uploaded_by_id: int | None
    uploaded_by_name: str | None
    created_at: datetime

    class Config:
        from_attributes = True
