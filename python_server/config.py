import os
from dataclasses import dataclass, field
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


# NOTE: The shared Legitify package `legitify_shared` is not available in this
# repository, so we keep a local Settings implementation. When `legitify_shared`
# is installed, this should be replaced with `BaseServiceSettings` or inherit
# from it.
@dataclass(frozen=True)
class Settings:
    app_name: str
    app_version: str
    port: int
    database_url: Optional[str]
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    db_min_connections: int
    db_max_connections: int
    db_schema: str
    db_ssl: bool
    node_env: str
    secret_key: str = field(repr=False)
    legitify_api_base_url: str
    redis_url: str
    audit_database_url: Optional[str]
    jwt_secret: Optional[str] = None
    # TEMPORARY: server-controlled tenant for the unauthenticated legacy POST /api/transfers.
    # This bridge is deleted once the legacy write path is retired or JWT auth is added.
    legacy_accountable_institution_id: Optional[int] = None


def _resolve_database_url() -> Optional[str]:
    return (
        os.getenv("ConveyHub_Transfers_POSTGRES_URL_NON_POOLING")
        or os.getenv("POSTGRES_URL_NON_POOLING")
        or os.getenv("ConveyHub_Transfers_POSTGRES_URL")
        or os.getenv("POSTGRES_URL")
        or os.getenv("DATABASE_URL")
    )


def load_settings() -> Settings:
    node_env = os.getenv("NODE_ENV", "development")
    raw_secret_key = os.getenv("SECRET_KEY")

    if raw_secret_key is None:
        if node_env == "production":
            raise ValueError("SECRET_KEY must be set in production")
        secret_key = "dev-secret-change-me"
    else:
        secret_key = raw_secret_key
        if node_env == "production" and (not secret_key or secret_key == "dev-secret-change-me"):
            raise ValueError("The default development SECRET_KEY cannot be used in production")

    raw_jwt_secret = os.getenv("JWT_SECRET")

    # TEMPORARY: parse the legacy tenant bridge without any production default.
    legacy_ai: Optional[int] = None
    raw_legacy_ai = os.getenv("LEGACY_ACCOUNTABLE_INSTITUTION_ID")
    if raw_legacy_ai is not None and raw_legacy_ai.strip() != "":
        try:
            parsed_legacy_ai = int(raw_legacy_ai)
            if parsed_legacy_ai > 0:
                legacy_ai = parsed_legacy_ai
        except ValueError:
            legacy_ai = None

    return Settings(
        app_name=os.getenv("APP_NAME", "Legitify ConveyHub API"),
        app_version=os.getenv("APP_VERSION", "1.0.0"),
        port=int(os.getenv("PORT", "3000")),
        database_url=_resolve_database_url(),
        db_host=os.getenv("DB_HOST", "localhost"),
        db_port=int(os.getenv("DB_PORT", "5432")),
        db_name=os.getenv("DB_NAME", "legitify_convey_hub"),
        db_user=os.getenv("DB_USER", "your_username"),
        db_password=os.getenv("DB_PASSWORD", "your_password"),
        db_min_connections=int(os.getenv("DB_MIN_CONNECTIONS", "2")),
        db_max_connections=int(os.getenv("DB_MAX_CONNECTIONS", "10")),
        db_schema=os.getenv("DB_SCHEMA", "transfers"),
        db_ssl=os.getenv("DB_SSL", "").lower() == "true",
        node_env=node_env,
        secret_key=secret_key,
        jwt_secret=raw_jwt_secret,
        legitify_api_base_url=os.getenv("LEGITIFY_API_BASE_URL", "http://localhost:8000"),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        audit_database_url=os.getenv("AUDIT_DATABASE_URL"),
        legacy_accountable_institution_id=legacy_ai,
    )
