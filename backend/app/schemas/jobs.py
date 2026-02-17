"""
Pydantic schemas for Jobs.
"""

from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class JobResponse(BaseModel):
    id: int
    external_job_id: Optional[str] = None
    client_name: str
    scheduled_start: Optional[datetime] = None

    class Config:
        from_attributes = True
