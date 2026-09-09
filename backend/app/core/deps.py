"""
FastAPI dependencies (auth).
- get_current_user: reads Bearer token, validates JWT, loads user from DB.
"""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.models.user import User
from app.db.session import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    # Require a Bearer token
    if creds is None or creds.scheme.lower() != "bearer":
        # LOG IT. The uvicorn access line says only "401 Unauthorized", and the
        # five 401 details below mean five very different things - a request with
        # no header at all is a CLIENT that lost its token, while an undecodable
        # one is a token/secret problem. Telling them apart from the log is what
        # the 2026-09-09 investigation could not do: a crew member lost a whole
        # job report to a 401 and there was no way to know which kind it was.
        #
        # Same shape as the 422 handler in app/main.py, and for the same reason.
        print(
            f"[401] no bearer credentials: scheme="
            f"{getattr(creds, 'scheme', None)!r}. The client sent no usable "
            f"Authorization header, so its stored token was missing or empty."
        )
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = creds.credentials

    try:
        payload = decode_token(token)
    except Exception as exc:
        # A token WAS sent and could not be decoded: expired, signed with a
        # different JWT_SECRET, or corrupt. Distinct from "no header at all"
        # above, and the distinction is the whole diagnosis.
        print(f"[401] token present but undecodable: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Ensure it's an access token (future-proof when we add reset tokens / refresh tokens)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user