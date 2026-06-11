"""
Authentication router.

Endpoints:
- POST /api/auth/signup
- POST /api/auth/login
- GET  /api/auth/me
- PATCH /api/auth/me
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/test-email
- GET  /api/auth/email-debug

Uses:
- bcrypt (directly)
- python-jose for JWT
- get_current_user dependency
"""

import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.db.models.user import User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, ForgotPasswordRequest, ResetPasswordRequest, PendingSignupResponse
from app.schemas.users import UpdateProfileRequest
from app.schemas.users import UserResponse
from app.core.security import (
    create_access_token,
    create_reset_token,
    hash_password,
    verify_password,
)
from app.core.deps import get_current_user, require_admin
from app.core.mailer import send_email


router = APIRouter(prefix="/api/auth", tags=["auth"])


# -----------------------------
# Signup
# -----------------------------
@router.post("/signup", response_model=PendingSignupResponse, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> PendingSignupResponse:
    """
    Self signup.
    - Email must be unique.
    - Password is hashed with bcrypt.
    - Account starts inactive; an admin must enable it before the user can log in.
    """

    email = payload.email.lower().strip()

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Handle bcrypt 72-byte limit cleanly
    try:
        pw_hash = hash_password(payload.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = User(
        email=email,
        password_hash=pw_hash,
        name=payload.name,
        role="user",
        is_active=False,  # admin must activate via Admin > Employees
    )

    db.add(user)
    db.commit()

    return PendingSignupResponse()


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

    # Auto-promote if this email is designated as admin via env var
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    if admin_email and user.email == admin_email and user.role != "admin":
        user.role = "admin"
        db.commit()

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
    Update the current user's profile (name and profile photo).
    Send profile_photo="" to clear the photo.
    """
    if payload.name is not None:
        current_user.name = payload.name.strip() or None
    if payload.profile_photo is not None:
        current_user.profile_photo = payload.profile_photo.strip() or None
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
    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    # Log only the user id + a coarse status — emails in Render logs are PII
    # and the id is enough to grep for context if a crew member calls about
    # a failed reset. The actual link surfaces in Postmark's audit trail.
    if not user:
        print("[forgot-password] no matching active account")
    elif not user.is_active:
        print(f"[forgot-password] user {user.id} found but inactive")

    if user and user.is_active:
        token, expiry = create_reset_token()
        user.reset_token = token
        user.reset_token_expiry = expiry
        db.commit()

        frontend_url = os.getenv("FRONTEND_URL", "https://mountaineer-crew-app.vercel.app").rstrip("/")
        reset_link = f"{frontend_url}/reset-password?token={token}"

        # Log the existence of a generated link without the link itself or
        # the user email — leaking either to Render logs gives anyone with
        # log access a working reset path.
        print(f"[forgot-password] reset link generated for user {user.id}")

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
            print(f"[forgot-password] email sent OK for user {user.id}")
        except Exception as exc:
            # Log so it shows in Render logs, but don't leak the error to the client.
            print(f"[forgot-password] email send FAILED for user {user.id}: {exc}")


# -----------------------------
# Reset password
# -----------------------------
@router.post("/reset-password", status_code=204)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> None:
    """
    Validate the reset token and update the password.
    """
    user = db.query(User).filter(User.reset_token == payload.token).first()

    if not user or not user.reset_token_expiry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    # SQLite returns naive datetimes even for DateTime(timezone=True) columns;
    # treat them as UTC to avoid TypeError on comparison.
    expiry = user.reset_token_expiry
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) > expiry:
        raise HTTPException(status_code=400, detail="Reset link has expired")

    try:
        user.password_hash = hash_password(payload.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user.reset_token = None
    user.reset_token_expiry = None
    db.commit()


class TestEmailRequest(BaseModel):
    to: str = "jacob@mountaineermoving.com"

@router.post("/test-email")
def test_email(payload: TestEmailRequest = TestEmailRequest(), _admin: User = Depends(require_admin)):
    """
    Attempt a real Postmark send and return detailed success/error info.
    Accepts optional JSON body: {"to": "someone@example.com"}
    """
    from app.core.mailer import send_email

    token = os.getenv("POSTMARK_SERVER_TOKEN", "").strip()
    smtp_from = os.getenv("SMTP_FROM", "").strip()

    if not token:
        return {"ok": False, "error": "POSTMARK_SERVER_TOKEN env var is not set on this server"}
    if not smtp_from:
        return {"ok": False, "error": "SMTP_FROM env var is not set on this server"}

    try:
        send_email(
            to_email=payload.to,
            subject="Mountaineer Crew App Test",
            text="If you received this, Postmark is working correctly."
        )
        return {"ok": True, "from": smtp_from, "to": payload.to}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/email-debug")
def email_debug(_admin: User = Depends(require_admin)):
    smtp_from = os.getenv("SMTP_FROM", "")
    frontend_url = os.getenv("FRONTEND_URL", "")
    postmark_token = os.getenv("POSTMARK_SERVER_TOKEN", "").strip()

    return {
        "smtp_from": smtp_from,
        "smtp_from_set": bool(smtp_from.strip()),
        "frontend_url": frontend_url,
        "postmark_token_set": bool(postmark_token),
        # show first 8 chars of token so you can confirm it matches Postmark dashboard
        "postmark_token_prefix": postmark_token[:8] if postmark_token else None,
    }
