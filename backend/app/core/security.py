"""
Security utilities:
- password hashing (bcrypt library directly)
- JWT token creation + verification (python-jose)

Why bcrypt directly (no passlib):
- Passlib + bcrypt 5.x can be flaky on Windows (version detection/backend issues).
- bcrypt itself is stable and widely used.
- bcrypt has a hard 72-byte input limit (we enforce it to avoid silent truncation).
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import jwt, JWTError

from app.core.config import settings


# ----------------------------
# Password hashing (bcrypt)
# ----------------------------

def _check_password_len(plain: str) -> None:
    """
    bcrypt only uses the first 72 bytes of the password.
    We enforce <=72 bytes to avoid silent truncation vulnerabilities.
    """
    if len(plain.encode("utf-8")) > 72:
        raise ValueError("Password too long (max 72 bytes).")


def hash_password(plain: str) -> str:
    """
    Hash a password with bcrypt.
    Returns a UTF-8 string you can store in the DB.
    """
    _check_password_len(plain)
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(plain.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plain password against a stored bcrypt hash.
    """
    try:
        _check_password_len(plain)
    except ValueError:
        # If it's too long, it can never match a stored bcrypt hash safely
        return False

    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ----------------------------
# JWT helpers (python-jose)
# ----------------------------

def create_access_token(subject: str) -> str:
    """
    Create a signed JWT access token with an expiration.
    `subject` is usually the user id as a string.
    """
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "type": "access",
    }

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_reset_token() -> tuple[str, datetime]:
    """
    Generate a secure random password reset token and its expiry (1 hour).
    Returns (token, expiry_datetime_utc).
    """
    token = secrets.token_urlsafe(32)
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    return token, expiry


def decode_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT.
    Raises ValueError if invalid/expired.
    """
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise ValueError("Invalid or expired token") from e