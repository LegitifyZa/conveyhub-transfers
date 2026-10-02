import asyncio
import os
import re
import ssl
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, List, Optional, TypeVar

import asyncpg

from config import Settings

T = TypeVar("T")


def _parse_command_tag(tag: str) -> int:
    match = re.search(r"\d+", tag)
    return int(match.group()) if match else 0


def _is_fetch_query(text: str) -> bool:
    stripped = text.strip().upper()
    return stripped.startswith("SELECT") or " RETURNING " in stripped


@dataclass
class QueryResult:
    rows: List[asyncpg.Record]
    row_count: Optional[int]


_pool: Optional[asyncpg.Pool] = None
_settings: Optional[Settings] = None
# Serializes pool creation so concurrent probes/requests during an outage
# cannot race create_pool and leak a duplicate pool. asyncio primitives are
# loop-bound, so locks are kept per running loop — a stale test loop must
# not wedge later loops.
_pool_locks: dict = {}


def _get_pool_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _pool_locks.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _pool_locks[loop] = lock
    return lock


def _dsn_param(dsn: Optional[str], name: str) -> Optional[str]:
    if not dsn:
        return None
    try:
        values = urllib.parse.parse_qs(urllib.parse.urlparse(dsn).query)
    except ValueError:
        return None
    return values.get(name, [None])[0]


def _resolve_db_tls(dsn: Optional[str], settings: Settings) -> Optional[ssl.SSLContext]:
    """Resolve the pool's TLS context.

    Certificate and hostname verification are the default whenever TLS is
    used (create_default_context: CERT_REQUIRED + check_hostname). A trusted
    CA can be supplied via the DSN sslrootcert param or DB_SSL_CA_FILE /
    PGSSLROOTCERT. Downgrading is explicit-only: sslmode=no-verify or
    DB_SSL_NO_VERIFY=true, always with a warning — never silent.
    """
    sslmode = _dsn_param(dsn, "sslmode") or os.getenv("PGSSLMODE")
    ca_file = _dsn_param(dsn, "sslrootcert") or settings.db_ssl_ca_file
    no_verify = sslmode == "no-verify" or settings.db_ssl_no_verify
    if sslmode is not None:
        use_tls = sslmode != "disable"  # an explicit DSN/env mode governs
    else:
        use_tls = settings.db_ssl or bool(ca_file) or settings.db_ssl_no_verify
    if not use_tls:
        return None
    if no_verify:
        if settings.node_env == "production":
            raise RuntimeError("database no-verify TLS is refused in production")
        print("WARNING: database TLS verification disabled by explicit no-verify configuration")
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    ctx = ssl.create_default_context()
    if ca_file:
        ctx.load_verify_locations(cafile=ca_file)
    return ctx


def _build_pool_kwargs(settings: Settings) -> dict:
    dsn = settings.database_url
    min_size = settings.db_min_connections
    max_size = settings.db_max_connections
    schema = settings.db_schema

    kwargs = {
        "min_size": min_size,
        "max_size": max_size,
        "command_timeout": 30,
        # Bound connection establishment itself — an unreachable host must
        # not hang startup or the readiness probe indefinitely.
        "timeout": 10,
        "server_settings": {"jit": "off"},
    }

    # asyncpg 0.31 has no channel-binding support (scram.pyx pins gs2 "n,,")
    # — a channel_binding DSN param is silently ignored by the driver.
    # 'require' is a contract we cannot honour, so it fails closed;
    # 'prefer' is explicitly documented as unenforceable (warned, allowed).
    if dsn:
        channel_binding = _dsn_param(dsn, "channel_binding")
        if channel_binding == "require":
            raise RuntimeError(
                "channel_binding=require is not supported: asyncpg cannot "
                "negotiate SCRAM-SHA-256-PLUS. Remove the requirement, use "
                "channel_binding=prefer (best-effort, currently ignored), or "
                "enforce channel binding server-side."
            )
        if channel_binding == "prefer":
            print(
                "WARNING: channel_binding=prefer is accepted but asyncpg 0.31 "
                "cannot negotiate channel binding — the preference is ignored"
            )

    tls = _resolve_db_tls(dsn, settings)
    if tls is not None:
        kwargs["ssl"] = tls

    if dsn:
        kwargs["dsn"] = dsn
    else:
        kwargs["host"] = settings.db_host
        kwargs["port"] = settings.db_port
        kwargs["database"] = settings.db_name
        kwargs["user"] = settings.db_user
        kwargs["password"] = settings.db_password

    if schema != "public":
        kwargs["server_settings"]["search_path"] = f'"{schema}", public'

        async def _set_search_path(conn):
            await conn.execute(f'SET search_path = "{schema}", public')

        kwargs["setup"] = _set_search_path

    return kwargs


async def get_pool(settings: Optional[Settings] = None) -> asyncpg.Pool:
    global _pool, _settings
    if settings is not None:
        _settings = settings
    if _settings is None:
        raise RuntimeError("Database settings have not been configured.")
    # An asyncpg pool is bound to the loop that created it — never hand a
    # foreign/closed loop's pool to this loop. LIMITATION: dropping the
    # reference is not resource cleanup — the orphaned pool's connections
    # persist until the owning loop closes them or the process exits. The
    # supported lifecycle is one loop that owns the pool and calls
    # close_pool() on that loop during shutdown (as lifespan does); the
    # discard here only prevents a stale test loop from poisoning a fresh
    # one, and callers must not rely on it to free sockets.
    if _pool is not None:
        bound = getattr(_pool, "_loop", None)
        if bound is not None and bound is not asyncio.get_running_loop():
            _pool = None
    if _pool is None:
        async with _get_pool_lock():
            if _pool is None:
                _pool = await asyncpg.create_pool(**_build_pool_kwargs(_settings))
    return _pool


def _normalize_params(params: Optional[List[Any]]) -> List[Any]:
    return [str(p) if isinstance(p, uuid.UUID) else p for p in (params or [])]


async def query(text: str, params: Optional[List[Any]] = None, *, connection: Optional[asyncpg.Connection] = None) -> QueryResult:
    params = _normalize_params(params)
    start = time.time()
    try:
        if connection is not None:
            if _is_fetch_query(text):
                rows = await connection.fetch(text, *params)
                result = QueryResult(rows=rows, row_count=len(rows))
            else:
                tag = await connection.execute(text, *params)
                result = QueryResult(rows=[], row_count=_parse_command_tag(tag))
        else:
            pool = await get_pool()
            if _is_fetch_query(text):
                rows = await pool.fetch(text, *params)
                result = QueryResult(rows=rows, row_count=len(rows))
            else:
                tag = await pool.execute(text, *params)
                result = QueryResult(rows=[], row_count=_parse_command_tag(tag))

        duration = (time.time() - start) * 1000
        node_env = _settings.node_env if _settings is not None else "development"
        if node_env != "production":
            print("Executed query", {"duration": round(duration), "rows": result.row_count})
        return result
    except Exception:
        print("Database query failed")
        raise


async def with_transaction(callback: Callable[[asyncpg.Connection], Awaitable[T]]) -> T:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await callback(conn)


async def check_database_health() -> dict:
    start = time.time()
    try:
        await query("SELECT NOW()")
        return {"healthy": True, "latency_ms": round((time.time() - start) * 1000)}
    except Exception as error:
        return {
            "healthy": False,
            "latency_ms": round((time.time() - start) * 1000),
            "error": "Database unavailable",
        }


def get_pool_stats() -> dict:
    global _pool
    if _pool is None:
        return {"total_count": 0, "idle_count": 0, "waiting_count": 0}

    idle = 0
    total = 0
    waiting = 0
    if hasattr(_pool, "_holders"):
        holders = _pool._holders
        total = len(holders)
        idle = sum(1 for h in holders if h._con is not None and h._con.is_closed() is False and h._in_use is False)
        queue = getattr(_pool, "_queue", None)
        waiting = queue.qsize() if queue is not None else 0
    return {
        "total_count": total,
        "idle_count": idle,
        "waiting_count": waiting,
    }


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        try:
            # If the pool was created in another loop (a now-closed test
            # loop, or any foreign loop) the connections are unusable from
            # here — discard the reference rather than await close() on the
            # wrong loop.
            loop = getattr(_pool, "_loop", None)
            if loop is not None and (loop.is_closed() or loop is not asyncio.get_running_loop()):
                _pool = None
                return
            await _pool.close()
        except RuntimeError as exc:
            # "Event loop is closed" is the expected symptom of a stale test loop.
            if "Event loop is closed" not in str(exc):
                raise
        except AttributeError as exc:
            # A closed proactor may raise "NoneType object has no attribute ..."
            # while tearing down a stale connection from a previous test loop.
            if "'NoneType' object has no attribute" not in str(exc):
                raise
        _pool = None
