"""
Users router.
Provides endpoint to create a user.
Now accepts JSON body instead of query params.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.users import UserCreate, UserResponse

router = APIRouter(prefix="/users", tags=["users"])


@router.post("", response_model=UserResponse)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """
    Creates a new user from JSON body:
    {
      "email": "...",
      "password": "..."
    }
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
