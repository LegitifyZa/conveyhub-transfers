from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import check_database_health, get_pool, get_pool_stats
from readiness import check_readiness

router = APIRouter()


# Back-compat aggregate check (kept for existing dashboards).
@router.get("/")
async def get_health():
    db_health = await check_database_health()
    status_code = 200 if db_health["healthy"] else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ok" if db_health["healthy"] else "error",
            "db": {
                "healthy": db_health["healthy"],
                "latencyMs": db_health["latency_ms"],
                "error": db_health.get("error"),
            },
            "pool": get_pool_stats(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# Liveness: process is up. No dependency checks.
@router.get("/live")
async def get_liveness():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# Readiness: bounded, read-only dependency + schema checks. Labels only.
@router.get("/ready")
async def get_readiness(request: Request):
    try:
        pool = await get_pool()
    except Exception:
        pool = None
    if pool is None:
        result = {"ready": False, "checks": {"config": "ok", "database": "unavailable", "schema": "unknown"}}
    else:
        result = await check_readiness(pool)
    return JSONResponse(
        status_code=200 if result["ready"] else 503,
        content={
            "status": "ready" if result["ready"] else "not-ready",
            "checks": result["checks"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
