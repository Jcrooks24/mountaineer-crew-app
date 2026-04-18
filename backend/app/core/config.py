"""
Application configuration — reads from environment variables with sensible defaults.
Set these on Render (or in a .env file locally):
  JWT_SECRET                    — required in prod; keep it secret
  ACCESS_TOKEN_EXPIRE_MINUTES   — default 10080 (7 days)
"""

import os
from pydantic import BaseModel

_DEV_JWT_FALLBACK = "dev-secret-change-me-please-use-at-least-32-chars"


def _resolve_jwt_secret() -> str:
    # Refuse to boot any deployed instance with the dev fallback.
    # Deployed = DATABASE_URL set (Render provisions that for both envs).
    secret = os.getenv("JWT_SECRET", "").strip()
    if secret:
        return secret
    if os.getenv("DATABASE_URL", "").strip():
        raise RuntimeError(
            "JWT_SECRET env var is required in deployed environments. "
            "Set it on the Render service and redeploy."
        )
    return _DEV_JWT_FALLBACK


class Settings(BaseModel):
    JWT_SECRET: str = _resolve_jwt_secret()
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")  # 7 days
    )


settings = Settings()
