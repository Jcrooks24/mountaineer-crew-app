from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PatchNoteCreate(BaseModel):
    title: str
    body: str


class PatchNoteUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None


class PatchNoteResponse(BaseModel):
    id: int
    title: str
    body: str
    created_by_id: Optional[int]
    created_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
