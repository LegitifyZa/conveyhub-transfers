import os
from dataclasses import dataclass
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
    secret_key: str
    entities_service_url: str
    redis_url: str
    audit_database_url: Optional[str]


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
        entities_service_url=os.getenv("ENTITIES_SERVICE_URL", "http://localhost:8003"),
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        audit_database_url=os.getenv("AUDIT_DATABASE_URL"),
    )
