"""Readiness checks (M1). Read-only and bounded: two SELECTs on the pool,
each under a 5s operation timeout. No writes, no migrations, no database
creation.

The schema prerequisite is the approved migration manifest: every file in
it must be recorded in public.transfers_schema_migrations with the
manifest's sha256. A ledger row not listed in the manifest is schema-drift
— for the controlled pilot the deployed schema must equal the approved
artifact exactly, so extras fail closed too. Deeper ledger integrity
(ordering, EOL canonicalisation) remains migrate-preflight's job.

Check labels are fixed strings — never connection details, hostnames or
driver error payloads that could carry credentials.
"""

import asyncio
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

_manifest_cache: Optional[dict] = None
_manifest_loaded = False


def _manifest_path(override: Optional[str] = None) -> str:
    return override or os.getenv("MIGRATIONS_MANIFEST") or _MANIFEST_PATH


def load_manifest(path: Optional[str] = None) -> Optional[dict]:
    """Return {filename: sha256-lowercase} from the approved manifest, or
    None when unreadable/malformed. Cached only for the default path."""
    global _manifest_cache, _manifest_loaded
    if path is None and _manifest_loaded:
        return _manifest_cache
    result: Optional[dict] = None
    try:
        with open(_manifest_path(path), "r", encoding="utf-8") as f:
            files = json.load(f).get("files")
        if isinstance(files, list):
            result = {
                e["file"]: str(e["sha256"]).lower()
                for e in files
                if isinstance(e.get("file"), str) and "sha256" in e
            }
    except (OSError, ValueError, AttributeError):
        result = None
    if path is None:
        _manifest_cache, _manifest_loaded = result, True
    return result


def expected_migration_count() -> Optional[int]:
    m = load_manifest()
    return len(m) if m is not None else None


def reset_readiness_cache() -> None:
    global _manifest_loaded
    _manifest_loaded = False


async def check_readiness(pool, *, config_valid: bool = True,
                          manifest_path: Optional[str] = None) -> dict:
    """pool: minimal object with fetch/fetchval — injectable so tests drive
    this without a database."""
    checks = {"config": "ok" if config_valid else "invalid-configuration",
              "database": "unavailable", "schema": "unknown"}

    try:
        await pool.fetchval("SELECT 1", timeout=5)
        checks["database"] = "ok"
    except Exception:
        return {"ready": False, "checks": checks}

    manifest = load_manifest(manifest_path)
    if manifest is None:
        checks["schema"] = "manifest-unavailable"
    else:
        try:
            rows = await pool.fetch(
                "SELECT filename, checksum FROM public.transfers_schema_migrations",
                timeout=5,
            )
            ledger = {
                r["filename"]: str(r["checksum"]).lower()
                for r in rows
                if isinstance(r["filename"], str)
            }
            for file, sha in manifest.items():
                actual = ledger.get(file)
                if actual is None:
                    checks["schema"] = "schema-missing-migrations"
                    break
                if actual != sha:
                    checks["schema"] = "schema-checksum-mismatch"
                    break
            else:
                extras = set(ledger) - set(manifest)
                checks["schema"] = "schema-drift" if extras else "ok"
        except Exception:
            checks["schema"] = "ledger-missing"

    ready = checks["config"] == "ok" and checks["schema"] == "ok"
    return {"ready": ready, "checks": checks}


# Per-loop in-flight probes: overlapping /ready requests share one bounded
# probe — a burst never creates N x probe work. Nothing is cached; once the
# task settles the next request starts a fresh check, so recovery is prompt.
_inflight: dict = {}


async def collect_readiness(get_pool, *, budget: float = 8.0) -> dict:
    """Bounded end-to-end readiness: pool creation/acquisition (which may
    wait on the creation lock behind a slow connect) plus the probes, all
    inside one deadline. wait_for cancels the inner task on expiry, so a
    stuck acquire/lock-wait cannot pin the endpoint — and the lock itself
    is released for the next probe. Callers shield() the shared task so a
    cancelled request cannot abort the probe for others."""
    not_ready = {"ready": False, "checks": {
        "config": "ok", "database": "unavailable", "schema": "unknown"}}

    async def _collect():
        try:
            pool = await get_pool()
        except Exception:
            return not_ready
        return await check_readiness(pool)

    async def _bounded():
        try:
            return await asyncio.wait_for(_collect(), timeout=budget)
        except Exception:
            return not_ready

    loop = asyncio.get_running_loop()
    task = _inflight.get(loop)
    if task is None or task.done():
        task = asyncio.ensure_future(_bounded())
        _inflight[loop] = task
        task.add_done_callback(
            lambda t: _inflight.pop(loop, None) if _inflight.get(loop) is t else None
        )
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        raise  # caller gone — the shared probe keeps running
    except Exception:
        return not_ready
