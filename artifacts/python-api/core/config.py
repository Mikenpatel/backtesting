"""
core/config.py — Application configuration.

Reads environment variables from .env file and exposes them as typed
Python attributes on a `settings` object.

Why pydantic-settings?
  - Automatically reads from .env file
  - Validates types (PORT must be an int, not a string "8081")
  - Raises a clear error on startup if a required variable is missing
  - Single import: `from core.config import settings`

Usage in any file:
    from core.config import settings
    print(settings.database_url)
    print(settings.fyers_app_id)
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    """
    All environment variables the application needs.

    Required variables (missing = server won't start):
      - database_url

    Optional variables (missing = graceful fallback):
      - fyers_app_id       → simulator mode if missing
      - fyers_access_token → simulator mode if missing
      - port               → defaults to 8081
    """

    # PostgreSQL connection string
    # Example: postgresql://postgres:postgres@localhost:5432/options_trader
    database_url: str

    # Fyers credentials — optional, enables live market data
    fyers_app_id: Optional[str] = None
    fyers_access_token: Optional[str] = None

    # Server port (8000; Node.js api-server at 8080 is no longer used)
    port: int = 8000

    # Tells pydantic-settings to read from .env file automatically
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,   # DATABASE_URL and database_url both work
    )

    @property
    def is_live_mode(self) -> bool:
        """True if both Fyers credentials are configured."""
        return bool(self.fyers_app_id and self.fyers_access_token)

    @property
    def fyers_auth_token(self) -> str:
        """
        Returns the combined auth token Fyers expects.
        Format: "{app_id}:{access_token}"
        Example: "QWOKW94G0J-100:eyJhbGci..."
        """
        return f"{self.fyers_app_id}:{self.fyers_access_token}"


# Single shared instance — import this everywhere
# Python modules are loaded once, so this is effectively a singleton
settings = Settings()
