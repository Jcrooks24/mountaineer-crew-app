"""
Users router.
Provides endpoint to create a user.
Now accepts JSON body instead of query params.
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_admin
from app.core.security import hash_password
from app.db.models.user import User
from app.db.models.user_email_alias import UserEmailAlias
from app.db.session import get_db
from app.schemas.users import DirectoryEntry, UserCreate, UserResponse

router = APIRouter(prefix="/api/users", tags=["users"])


@router.post("", response_model=UserResponse)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin-only user creation. The self-service signup flow is at
    /api/auth/signup (pending-approval by default). This endpoint bypasses
    that approval - hence the admin gate.
    """
    # Normalize the email the same way the self-service signup path does
    # (auth.py:58). Without this, an admin-created "Foo@Bar.com" lives
    # alongside the lowercased aliases and Crew Resources matching breaks
    # in subtle ways.
    email = (payload.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email is required")

    existing_primary = db.query(User.id).filter(User.email == email).first()
    if existing_primary:
        raise HTTPException(status_code=400, detail="Email already registered")
    # Also reject collisions with the alias table so admin can't create a
    # primary that shadows someone else's alternate address.
    existing_alias = db.query(UserEmailAlias.id).filter(UserEmailAlias.email == email).first()
    if existing_alias:
        raise HTTPException(
            status_code=409,
            detail="That email is already an alias for another crew member",
        )

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


@router.get("/directory", response_model=List[DirectoryEntry])
def list_directory(
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> List[DirectoryEntry]:
    """
    Lists active users (id, email, name, profile photo) so crew members can see
    each other's profile photos in activity logs, photos, etc.
    """
    users = (
        db.query(User)
        .filter(User.is_active.is_(True))
        .order_by(User.name.asc().nullslast(), User.email.asc())
        .limit(200)
        .all()
    )
    return users
