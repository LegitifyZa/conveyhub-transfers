"""Staff-only v1 property discovery.

Same-institution search used to select an existing property for a new
matter–property link. Returns the allow-listed projection only — never the
full column set — and performs no upstream calls. Verification is not
inferred from external identifiers; `manual`/`sourceSystem` are exposed
verbatim so callers can show provenance honestly.
"""

from fastapi import APIRouter, Depends, HTTPException, Request

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from routers.v1.transfers import _map_property
from services.matter_property_service import search_properties

router = APIRouter()

_DISCOVERY_LIMIT_MAX = 50


@router.get("")
async def discover_properties(
    request: Request,
    user: CurrentUser = Depends(require_jwt),
):
    """List same-institution properties matching an optional query.

    Clients (role 4) fail closed: property discovery is a staff surface.
    Every other caller needs transfers:read; results are scoped to the
    verified accountable institution for every role.
    """
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    query_text = request.query_params.get("query") or request.query_params.get("q")
    if query_text is not None and not isinstance(query_text, str):
        raise HTTPException(status_code=422, detail="query must be a string")

    try:
        limit = int(request.query_params.get("limit", "25"))
    except (TypeError, ValueError):
        limit = 25
    limit = min(_DISCOVERY_LIMIT_MAX, max(1, limit))

    rows = await search_properties(
        user.accountable_institution_id,
        query_text.strip() if query_text else None,
        limit,
    )
    return {
        "message": "OK",
        "data": {"properties": [_map_property(row) for row in rows]},
    }
