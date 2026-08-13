from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from db import check_database_health, get_pool_stats

router = APIRouter()


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
