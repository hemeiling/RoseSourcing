"""Application configuration, loaded from environment variables (and backend/.env locally)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AI Commerce OS"
    environment: str = "development"

    # Database: Render provides postgresql://...; normalized to the psycopg3 driver below.
    database_url: str = "postgresql+psycopg://localhost:5432/aicommerce"

    # Auth
    secret_key: str = "dev-insecure-change-me"
    access_token_ttl_hours: int = 24 * 7
    # Signup policy: the first account can always register. After that, signups are
    # closed unless SIGNUP_ENABLED=true or the email is in ALLOWED_SIGNUP_EMAILS.
    signup_enabled: bool = False
    allowed_signup_emails: str = ""

    # Anthropic / LLM
    anthropic_api_key: str | None = None
    llm_model: str = "claude-opus-5-5"
    llm_effort: str = "medium"
    # Server-side refusal fallback (beta). Set to "off" to disable.
    anthropic_fallbacks: str = "default"
    web_search_tool_type: str = "web_search_20260209"

    # Research providers: anthropic_web_search | tavily | brave
    research_provider: str = "anthropic_web_search"
    tavily_api_key: str | None = None
    brave_search_api_key: str | None = None

    # Guardrails
    max_searches_per_step: int = 5
    max_research_cost_usd: float = 5.0
    max_step_attempts: int = 2
    copilot_max_tool_rounds: int = 8

    # Future integrations (not required for MVP)
    shopify_store_domain: str | None = None
    shopify_admin_token: str | None = None

    # Static frontend build (Next.js export) served by FastAPI when present.
    frontend_dist: str = Field(default="../frontend/out")

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://") :]
        return v

    @property
    def allowed_signup_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_signup_emails.split(",") if e.strip()}

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
