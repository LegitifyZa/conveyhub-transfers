import asyncio
import os
import re
import ssl
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, List, Optional, TypeVar

import asyncpg
from dotenv import load_dotenv

load_dotenv()

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


def _get_dsn() -> str:
    return (
        os.getenv("ConveyHub_Transfers_POSTGRES_URL_NON_POOLING")
        or os.getenv("POSTGRES_URL_NON_POOLING")
        or os.getenv("ConveyHub_Transfers_POSTGRES_URL")
        or os.getenv("POSTGRES_URL")
        or os.getenv("DATABASE_URL")
    )


def _build_pool_kwargs() -> dict:
    dsn = _get_dsn()
    min_size = int(os.getenv("DB_MIN_CONNECTIONS", "2"))
    max_size = int(os.getenv("DB_MAX_CONNECTIONS", "10"))
    schema = os.getenv("DB_SCHEMA", "Transfers")

    kwargs = {
        "min_size": min_size,
        "max_size": max_size,
        "command_timeout": 30,
        "server_settings": {"jit": "off"},
    }

    needs_ssl = (
        (dsn and "sslmode=require" in dsn)
        or os.getenv("DB_SSL") == "true"
    )
    if needs_ssl:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["ssl"] = ctx

    if dsn:
        kwargs["dsn"] = dsn
    else:
        kwargs["host"] = os.getenv("DB_HOST", "localhost")
        kwargs["port"] = int(os.getenv("DB_PORT", "5432"))
        kwargs["database"] = os.getenv("DB_NAME", "legitify_convey_hub")
        kwargs["user"] = os.getenv("DB_USER", "your_username")
        kwargs["password"] = os.getenv("DB_PASSWORD", "your_password")

    if schema != "public":
        kwargs["server_settings"]["search_path"] = f'"{schema}", public'

    return kwargs


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(**_build_pool_kwargs())
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
        if os.getenv("NODE_ENV") != "production":
            print("Executed query", {"text": text[:200], "duration": round(duration), "rows": result.row_count})
        return result
    except Exception as error:
        print("Query error:", {"text": text, "params": params, "error": error})
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
            "error": str(error),
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
        await _pool.close()
        _pool = None
