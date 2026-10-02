"""Readiness checks (M1). Read-only and bounded: two SELECTs on the pool
with a 5s statement cap. No writes, no migrations, no database creation.

The schema prerequisite is the migration ledger: the applied-row count must
equal the approved manifest's fileCount — pending or partial schema means
not ready. Deeper ledger integrity is migrate-preflight's job.

Check labels are fixed strings — never connection details, hostnames or
driver error payloads that could carry credentials.
"""

import json
import os
from typing import Optional

_MANIFEST_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "src",
    "lib",
    "migrations",
    "manifest.json",
)

_expected_count: Optional[int] = None
_expected_loaded = False


def expected_migration_count() -> Optional[int]:
    global _expected_count, _expected_loaded
    if _expected_loaded:
        return _expected_count
    path = os.getenv("MIGRATIONS_MANIFEST") or _MANIFEST_PATH
    try:
        with open(path, "r", encoding="utf-8") as f:
            count = json.load(f).get("fileCount")
        _expected_count = count if isinstance(count, int) else None
    except (OSError, ValueError):
        _expected_count = None
    _expected_loaded = True
    return _expected_count


def reset_readiness_cache() -> None:
    global _expected_loaded
    _expected_loaded = False


async def check_readiness(pool, *, config_valid: bool = True) -> dict:
    """pool: minimal object with fetchval(sql, timeout=...) — injectable so
    tests drive this without a database."""
    checks = {"config": "ok" if config_valid else "invalid-configuration",
              "database": "unavailable", "schema": "unknown"}

    try:
        await pool.fetchval("SELECT 1", timeout=5)
        checks["database"] = "ok"
    except Exception:
        return {"ready": False, "checks": checks}

    expected = expected_migration_count()
    if expected is None:
        checks["schema"] = "manifest-unavailable"
        return {"ready": False, "checks": checks}
    try:
        applied = await pool.fetchval(
            "SELECT count(*) FROM public.transfers_schema_migrations", timeout=5
        )
        checks["schema"] = "ok" if applied == expected else "schema-incomplete"
    except Exception:
        checks["schema"] = "ledger-missing"

    ready = checks["config"] == "ok" and checks["schema"] == "ok"
    return {"ready": ready, "checks": checks}
