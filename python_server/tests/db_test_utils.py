import os
import unittest
from typing import Awaitable, Callable, Optional, TypeVar

T = TypeVar("T")

# Environment keys that the production Settings resolver may consult.
# We remove these before runs so a test cannot accidentally fall back to a
# real/shared database when only TEST_DATABASE_URL is intended.
_DB_URL_ENV_KEYS = [
    "ConveyHub_Transfers_POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL_NON_POOLING",
    "ConveyHub_Transfers_POSTGRES_URL",
    "POSTGRES_URL",
    "DATABASE_URL",
]


def get_test_database_url() -> Optional[str]:
    return os.getenv("TEST_DATABASE_URL")


def require_test_database() -> str:
    """Configure the process environment so integration tests use only TEST_DATABASE_URL.

    Raises unittest.SkipTest if TEST_DATABASE_URL is not set, so an entire
    test class is skipped cleanly in Mode A.
    """
    url = get_test_database_url()
    if not url:
        raise unittest.SkipTest("TEST_DATABASE_URL is not set; skipping DB integration test")

    # Remove any higher-precedence DSN variables and the legacy fallback keys.
    for key in _DB_URL_ENV_KEYS:
        os.environ.pop(key, None)

    # Set the single production-resolved key that Settings.load() looks for first.
    os.environ["ConveyHub_Transfers_POSTGRES_URL"] = url
    os.environ.setdefault("DB_SCHEMA", "transfers")
    return url


async def get_test_pool():
    """Return a pool connected to TEST_DATABASE_URL, closing any stale pool first."""
    from db import close_pool, get_pool
    from config import load_settings

    await close_pool()
    return await get_pool(load_settings())


async def with_test_transaction(callback: Callable[[object], Awaitable[T]]) -> T:
    """Run callback(conn) inside a transaction that is unconditionally rolled back."""
    from db import get_pool
    from config import load_settings

    pool = await get_pool(load_settings())
    async with pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            return await callback(conn)
        finally:
            await tx.rollback()
