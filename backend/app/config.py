from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Gemini free tier is quota'd per model per day, so a chain of models multiplies the
# daily budget (same approach as zizi-tripo). Ordered best-first.
DEFAULT_GEMINI_MODEL = "gemini-3.7-flash"
DEFAULT_GEMINI_FALLBACKS = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    mongodb_uri: str = "mongodb://localhost:27018"
    database_name: str = "woodchunk"

    # "dev" accepts `Bearer dev:<email>` tokens so the app runs without a login provider.
    auth_mode: Literal["dev", "descope"] = "dev"
    descope_project_id: str = ""
    admin_emails: str = ""  # comma separated; these users become admins on sign-in

    frontend_url: str = "http://localhost:3000"

    google_api_key: str = ""
    gemini_model: str = DEFAULT_GEMINI_MODEL
    gemini_fallbacks: str = DEFAULT_GEMINI_FALLBACKS
    ai_model_timeout_seconds: float = 25.0
    ai_total_budget_seconds: float = 75.0

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def model_chain(self) -> list[str]:
        chain = [self.gemini_model] + [m.strip() for m in self.gemini_fallbacks.split(",") if m.strip()]
        return list(dict.fromkeys(chain))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Checked here rather than in a validator so the error never echoes secrets from the environment.
    # Dev tokens let anyone sign in as any email, so a public server must never run with them.
    if s.environment == "production" and s.auth_mode != "descope":
        raise RuntimeError("ENVIRONMENT=production requires AUTH_MODE=descope")
    if s.auth_mode == "descope" and not s.descope_project_id:
        raise RuntimeError("AUTH_MODE=descope requires DESCOPE_PROJECT_ID")
    return s
