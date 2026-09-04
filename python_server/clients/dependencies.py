"""FastAPI dependencies for the Legitify service clients.

Mirrors ``auth.dependencies``: the dependency reads process-wide state off
``request.app.state``, which the application lifespan owns. The single
``EntitiesClient`` is created once at startup and closed at shutdown — httpx
pools connections inside the client, so constructing one per request would
create (and leak) a fresh connection pool on every call.
"""

from fastapi import Request

from clients.entities import EntitiesClient

from .exceptions import GOLDEN_RECORD_SERVICE_UNAVAILABLE


async def get_entities_client(request: Request) -> EntitiesClient:
    """Return the application's Legitify client, or 503 if it is not available.

    The client is absent only when the lifespan has not run or has already torn
    down. That is an internal fault, so it is reported with the same tenant-safe
    503 as an upstream outage rather than leaking configuration state.
    """
    client = getattr(request.app.state, "entities_client", None)
    if client is None:
        raise GOLDEN_RECORD_SERVICE_UNAVAILABLE
    return client
