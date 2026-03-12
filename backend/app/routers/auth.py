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
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, ForgotPasswordRequest, ResetPasswordRequest
from app.schemas.users import UpdateProfileRequest
from app.schemas.users import UserResponse
from app.core.security import (
    create_access_token,
    create_reset_token,
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


@router.patch("/me", response_model=UserResponse)
def update_me(
    payload: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserResponse:
    """
    Update the current user's profile (name only for now).
    """
    if payload.name is not None:
        current_user.name = payload.name.strip() or None
    db.commit()
    db.refresh(current_user)
    return current_user

# -----------------------------
# Forgot password
# -----------------------------
@router.post("/forgot-password", status_code=204)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> None:
    """
    Generate a reset token and email a reset link.
    Always returns 204 to avoid leaking whether the email exists.
    """
    import os
    from app.core.mailer import send_email

    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    if user and user.is_active:
        token, expiry = create_reset_token()
        user.reset_token = token
        user.reset_token_expiry = expiry
        db.commit()

        frontend_url = os.getenv("FRONTEND_URL", "https://mountaineer-crew-app.vercel.app").rstrip("/")
        reset_link = f"{frontend_url}/reset-password?token={token}"

        try:
            send_email(
                to_email=user.email,
                subject="Reset your Mountaineer Crew App password",
                text=(
                    f"Hi{' ' + user.name if user.name else ''},\n\n"
                    f"Click the link below to reset your password. It expires in 1 hour.\n\n"
                    f"{reset_link}\n\n"
                    f"If you didn't request this, you can ignore this email."
                ),
            )
        except Exception as exc:
            # Log so it shows in Render logs, but don't leak the error to the client
            print(f"[forgot-password] email send FAILED for {user.email}: {exc}")


# -----------------------------
# Reset password
# -----------------------------
@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> None:
    """
    Validate the reset token and update the password.
    """
    from datetime import datetime, timezone

    user = db.query(User).filter(User.reset_token == payload.token).first()

    if not user or not user.reset_token_expiry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    if datetime.now(timezone.utc) > user.reset_token_expiry:
        raise HTTPException(status_code=400, detail="Reset link has expired")

    try:
        user.password_hash = hash_password(payload.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user.reset_token = None
    user.reset_token_expiry = None
    db.commit()


@router.post("/test-email")
def test_email():
    from app.core.mailer import send_email

    send_email(
        to_email="jacob@mountaineermoving.com",
        subject="Mountaineer Crew App Test",
        text="If you received this, SMTP is working."
    )

    return {"ok": True} 

@router.get("/email-debug")
def email_debug():
    import os

    # DO NOT return tokens; only safe info
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = os.getenv("SMTP_PORT", "")
    smtp_from = os.getenv("SMTP_FROM", "")
    frontend_url = os.getenv("FRONTEND_URL", "")
    smtp_user = os.getenv("SMTP_USER", "")

    return {
        "smtp_host_set": bool(smtp_host.strip()),
        "smtp_host": smtp_host,               # not secret
        "smtp_port": smtp_port,               # not secret
        "smtp_from": smtp_from,               # not secret
        "frontend_url": frontend_url,         # not secret
        "smtp_user_len": len(smtp_user.strip()),
        "smtp_user_prefix": smtp_user.strip()[:6],  # tiny prefix only (safe-ish)
        "postmark_token_set": bool(os.getenv("POSTMARK_SERVER_TOKEN", "").strip()),
    }