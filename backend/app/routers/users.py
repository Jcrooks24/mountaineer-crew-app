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
    that approval — hence the admin gate.
    """
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
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
