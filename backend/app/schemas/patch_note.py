from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class PatchNoteCreate(BaseModel):
    title: str
    body: str
    # The build this note describes. Optional: a note can be written before the
    # build is out, and linking is a separate deliberate act.
    build_id: Optional[str] = None


class PatchNoteUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    # "" clears the link, None leaves it alone. A single optional field cannot
    # otherwise distinguish "unlink this" from "do not touch the link".
    build_id: Optional[str] = None


class PatchNoteResponse(BaseModel):
    id: int
    title: str
    body: str
    build_id: Optional[str] = None
    created_by_id: Optional[int]
    created_by_name: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
