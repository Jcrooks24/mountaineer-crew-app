"""
Application configuration — reads from environment variables with sensible defaults.
Set on Render (or in a .env file locally):
  JWT_SECRET                    — required in prod; keep it secret
  ACCESS_TOKEN_EXPIRE_MINUTES   — default 10080 (7 days)
"""

import os
from pydantic import BaseModel


class Settings(BaseModel):
    JWT_SECRET: str = os.getenv(
        "JWT_SECRET", "dev-secret-change-me-please-use-at-least-32-chars"
    )
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080")  # 7 days
    )


settings = Settings()
