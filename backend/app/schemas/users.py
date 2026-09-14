"""
Pydantic schemas for Users.
Defines request/response body shapes.
"""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# The colorblind-friendly palettes a crew member can pick for their own
# Availability tools (ADR 0050). Must match AVAILABILITY_PALETTES in
# frontend/src/lib/availabilityPalette.ts.
AvailabilityPalette = Literal[
    "default", "red_green", "deuteranopia", "protanopia", "tritanopia", "monochrome",
]


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
    # A plain str on the way OUT, so a value this build does not know (a newer
    # palette written by a later build) still serializes; the client falls back.
    availability_palette: str = "default"
    # Admin-set skill-rating designation (see User.is_skill_rater). Surfaced to
    # the client so the Job Report can gate job-type + skill view/edit on it.
    is_skill_rater: bool = False

    class Config:
        from_attributes = True  # Allows returning SQLAlchemy models directly


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    # Data URL (e.g. "data:image/jpeg;base64,..."). Send "" or null to clear.
    profile_photo: str | None = None
    # Free-form scheduling notes (e.g. "no Saturdays until July"). Send "" to clear.
    scheduling_notes: str | None = None
    # Validated on the way IN: an unknown palette is a 422, never stored.
    availability_palette: AvailabilityPalette | None = None


class DirectoryEntry(BaseModel):
    id: int
    email: EmailStr
    name: str | None = None
    profile_photo: str | None = None
    # Added for the crew employee directory (2026-09-04). This endpoint was
    # already showing every active crew member's name and email to every signed-in
    # crew member (it backs the profile photos in activity logs), so the phone
    # number widens what colleagues can see about each other rather than opening
    # a new door. That is the point of the directory: crew look each other up.
    # It stays limited to ACTIVE users - see the endpoint.
    phone: str | None = None

    class Config:
        from_attributes = True
