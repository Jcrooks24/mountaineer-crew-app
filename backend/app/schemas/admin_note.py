from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AdminNoteCreate(BaseModel):
    title: str
    body: str
    job_uuid: Optional[str] = None  # omit or blank for a global note


class AdminNoteUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    job_uuid: Optional[str] = None  # explicitly "" to clear (make global)


class AdminNoteResponse(BaseModel):
    id: int
    title: str
    body: str
    job_uuid: Optional[str]
    created_by_id: Optional[int]
    created_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
