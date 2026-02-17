"""
Security utilities:
- password hashing (bcrypt)
- JWT token creation + verification
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt  # PyJWT

from app.core.config import settings


# ----------------------------
# Password hashing
# ----------------------------

def hash_password(plain: str) -> str:
    """
    Hash a password with bcrypt.
    Returns a UTF-8 string you can store in the DB.
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(plain.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plain password against a stored bcrypt hash.
    """
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ----------------------------
# JWT helpers
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
        "typ": "access",
    }

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """
    Decode and validate a JWT.
    Raises exceptions if invalid/expired.
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
