from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from clients.dependencies import get_entities_client
from clients.entities import SUPPORTED_ENTITY_TYPES, EntitiesClient, EntityServiceError
from services.entity_reconciliation import EntityReconciliationError
from services.golden_record_search import (
    GoldenRecordCandidate,
    GoldenRecordSearchResult,
    GoldenRecordSearchService,
)
from services.golden_record_visibility import (
    UPSTREAM_UNAVAILABLE_MESSAGE,
    GoldenRecordVisibilityError,
)

router = APIRouter()

# Allow-list: anything else (tenant ids, actor fields, undocumented search keys)
# is rejected rather than silently ignored.
_ALLOWED_BODY_KEYS = {"entity_type", "id_number", "passport_number", "passport_country"}
_PERSON_FIELD_KEYS = ("id_number", "passport_number", "passport_country")


def _map_candidate(candidate: GoldenRecordCandidate) -> dict:
    return {
        "goldenRecordId": candidate.golden_record_id,
        "entityType": candidate.entity_type,
        "name": candidate.name,
        "idNumber": candidate.id_number,
        "email": candidate.email,
    }


def _map_result(result: GoldenRecordSearchResult) -> dict:
    data = {"status": result.status.value, "entityType": result.entity_type}
    if result.record is not None:
        data["record"] = _map_candidate(result.record)
    if result.candidates:
        data["candidates"] = [_map_candidate(candidate) for candidate in result.candidates]
    if result.detail is not None:
        data["detail"] = result.detail
    return data


def _optional_string_field(body: dict, field: str) -> Optional[str]:
    value = body.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field} must be a string")
    return value


@router.post("/search")
async def search_golden_records(
    body: dict,
    user: CurrentUser = Depends(require_jwt),
    entities_client: EntitiesClient = Depends(get_entities_client),
):
    """Search Golden Records, returning only candidates visible to the caller's AI.

    The accountable institution is derived from the authenticated user, never
    from the request body. Upstream search is unscoped by tenant, so every
    candidate is filtered through the linkage-based visibility flow before it
    can appear in the response.
    """

    # Client Golden Record search is not documented; fail closed like the
    # other v1 routes.
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")

    # No separate search ability is documented; reuse transfers:read.
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="A JSON object body is required")

    keys = set(body.keys())
    if "entity_type" not in keys:
        raise HTTPException(status_code=422, detail="Missing required field(s): entity_type")
    unexpected = keys - _ALLOWED_BODY_KEYS
    if unexpected:
        raise HTTPException(
            status_code=422, detail=f"Unexpected field(s): {', '.join(sorted(unexpected))}"
        )

    entity_type = body["entity_type"]
    if entity_type not in SUPPORTED_ENTITY_TYPES:
        raise HTTPException(
            status_code=422,
            detail="entity_type must be one of 'person', 'company' or 'trust'",
        )

    service = GoldenRecordSearchService(entities_client)
    try:
        result = await service.search(
            entity_type=entity_type,
            accountable_institution_id=user.accountable_institution_id,
            id_number=_optional_string_field(body, "id_number"),
            passport_number=_optional_string_field(body, "passport_number"),
            passport_country=_optional_string_field(body, "passport_country"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GoldenRecordVisibilityError as exc:
        return JSONResponse(
            status_code=exc.http_status,
            content={"success": False, "error": exc.public_message},
        )
    except (EntityServiceError, EntityReconciliationError):
        # Integration faults are never tenant decisions.
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": UPSTREAM_UNAVAILABLE_MESSAGE},
        )

    return {"message": "OK", "data": _map_result(result)}
