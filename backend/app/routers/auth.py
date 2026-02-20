"""
Authentication router.

Endpoints:
- POST /api/auth/signup
- POST /api/auth/login
- GET  /api/auth/me

Uses:
- bcrypt (directly)
- python-jose for JWT
- get_current_user dependency
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.user import User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse
from app.schemas.users import UserResponse
from app.core.security import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.core.deps import get_current_user


router = APIRouter(prefix="/api/auth", tags=["auth"])


# -----------------------------
# Signup
# -----------------------------
@router.post("/signup", response_model=TokenResponse)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Self signup.
    - Email must be unique.
    - Password is hashed with bcrypt.
    - Returns access token immediately.
    """

    email = payload.email.lower().strip()

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # 🔐 Handle bcrypt 72-byte limit cleanly
    try:
        pw_hash = hash_password(payload.password)
    except ValueError as e:
        # Converts hashing failure into proper user-level error
        raise HTTPException(status_code=400, detail=str(e))

    user = User(
        email=email,
        password_hash=pw_hash,
        name=payload.name,
        role="user",
        is_active=True,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id))

    return TokenResponse(access_token=token)


# -----------------------------
# Login
# -----------------------------
@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """
    Verify credentials and return JWT.
    """

    email = payload.email.lower().strip()

    user = db.query(User).filter(User.email == email).first()

    # Don't leak which part failed
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(subject=str(user.id))

    return TokenResponse(access_token=token)


# -----------------------------
# Current user
# -----------------------------
@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """
    Returns currently authenticated user.
    """
    return current_user

@router.post("/test-email")
def test_email():
    from app.core.mailer import send_email

    send_email(
        to_email="jacob@mountaineermoving.com",
        subject="Mountaineer Crew App Test",
        text="If you received this, SMTP is working."
    )

    return {"ok": True}    