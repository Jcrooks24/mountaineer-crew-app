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

    class Config:
        from_attributes = True  # Allows returning SQLAlchemy models directly


class UpdateProfileRequest(BaseModel):
    name: str | None = None
