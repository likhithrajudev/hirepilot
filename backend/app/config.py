from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database: either DATABASE_URL, or DB_HOST/DB_USER/... (injected by ECS from Secrets Manager)
    database_url: str = "sqlite:///./data/app.db"
    db_host: str = ""
    db_port: int = 5432
    db_name: str = "hirepilot"
    db_user: str = ""
    db_password: str = ""

    # Used to derive the key that encrypts the stored OpenAI key. Change it in production.
    secret_key: str = "dev-secret-change-me"
    # If set, every /api request (except /api/health) must send `X-App-Token: <value>`.
    app_token: str = ""

    # Optional server-side fallback; the UI-provided key takes precedence.
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    code_runner_url: str = ""
    code_runner_token: str = ""

    # Read cache: "off" | "memory" (per process) | "redis" (shared; needed once more than one API instance runs,
    # because invalidation must be seen by every instance).
    cache_backend: str = "memory"
    redis_url: str = ""
    cache_ttl_seconds: int = 30

    # ---- accounts ----
    public_base_url: str = "http://localhost:3000"  # the browser-facing origin; OAuth redirects and CSRF checks use it
    access_token_minutes: int = 15
    refresh_token_days: int = 30
    cookie_secure: bool = False  # true behind HTTPS
    signup_open: bool = True
    admin_emails: str = ""  # comma separated; these accounts become platform admins on signup
    claim_legacy_email: str = ""  # if set, only this email may claim data created before accounts existed
    fast_password_hash: bool = False  # tests only
    # OAuth providers: a provider is enabled when its credentials are present
    google_client_id: str = ""
    google_client_secret: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""
    apple_client_id: str = ""  # the Services ID
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""  # contents of the .p8 file ("\n" escapes allowed)
    # Outgoing mail (password reset). Without SMTP_HOST, links are written to the server log instead.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    mail_from: str = "HirePilot <no-reply@localhost>"

    # ---- billing ----
    # With Stripe configured, checkout and webhooks are real. Without it a clearly-labelled test mode applies plans
    # instantly with no charge, so the whole upgrade/cancel flow can be built and demonstrated.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_prices: str = ""  # JSON: {"pilot:month:USD": "price_...", "pilot:year:USD": "...", "captain:month:INR": "..."}
    sales_email: str = "sales@hirepilot.example"

    cors_origins: str = "http://localhost:3000"
    latex_timeout: int = 40

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_secret_key and self.stripe_webhook_secret and self.stripe_prices)

    @property
    def effective_database_url(self) -> str:
        if self.db_host:
            return (
                f"postgresql+psycopg://{quote_plus(self.db_user)}:{quote_plus(self.db_password)}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}"
            )
        return self.database_url


settings = Settings()
