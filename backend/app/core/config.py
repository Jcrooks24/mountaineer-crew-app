"""
Application configuration.
For now, simple hardcoded settings.
Later we move to environment variables.
"""

from pydantic import BaseModel


class Settings(BaseModel):
    JWT_SECRET: str = "dev-secret-change-me-please-use-at-least-32-chars"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30


settings = Settings()
