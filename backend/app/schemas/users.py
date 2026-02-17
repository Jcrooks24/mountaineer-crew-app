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

    class Config:
        from_attributes = True  # Allows returning SQLAlchemy models directly
