"""
Pydantic schemas for Users.
Defines request/response body shapes.
"""

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)



class UserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str | None = None
    role: str | None = None
    profile_photo: str | None = None
    scheduling_notes: str = ""

    class Config:
        from_attributes = True  # Allows returning SQLAlchemy models directly


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    # Data URL (e.g. "data:image/jpeg;base64,..."). Send "" or null to clear.
    profile_photo: str | None = None
    # Free-form scheduling notes (e.g. "no Saturdays until July"). Send "" to clear.
    scheduling_notes: str | None = None


class DirectoryEntry(BaseModel):
    id: int
    email: EmailStr
    name: str | None = None
    profile_photo: str | None = None

    class Config:
        from_attributes = True
