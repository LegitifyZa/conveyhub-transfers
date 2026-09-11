import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
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
    resolve_visible_golden_record,
)

router = APIRouter()
RETRIEVAL_TIMEOUT_SECONDS = 30
_NO_STORE_HEADERS = {"Cache-Control": "no-store"}

# Allow-list: anything else (tenant ids, actor fields, undocumented search keys)
# is rejected rather than silently ignored.
_ALLOWED_BODY_KEYS = {"entity_type", "query"}


def _map_candidate(candidate: GoldenRecordCandidate) -> dict:
    data = {
        "goldenRecordId": candidate.golden_record_id,
        "entityType": candidate.entity_type,
        "name": candidate.name,
        "idNumber": candidate.id_number,
        "email": candidate.email,
    }
    if candidate.entity_type in {"company", "trust"}:
        data.update(
            registrationNo=candidate.registration_no,
            mastersOffice=candidate.masters_office,
            isTrust=candidate.is_trust,
        )
    return data


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
    if not isinstance(entity_type, str) or entity_type not in SUPPORTED_ENTITY_TYPES:
        raise HTTPException(
            status_code=422,
            detail="entity_type must be one of 'person', 'company' or 'trust'",
        )

    service = GoldenRecordSearchService(entities_client)
    try:
        result = await service.search(
            entity_type=entity_type,
            accountable_institution_id=user.accountable_institution_id,
            query=_optional_string_field(body, "query"),
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


@router.get("/{golden_record_id}")
async def retrieve_golden_record(
    golden_record_id: str,
    request: Request,
    entity_type: Optional[str] = None,
    user: CurrentUser = Depends(require_jwt),
    entities_client: EntitiesClient = Depends(get_entities_client),
):
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")
    if list(request.query_params.multi_items()) != [("entity_type", entity_type)]:
        raise HTTPException(status_code=422, detail="Exactly one entity_type query parameter is required")

    try:
        async with asyncio.timeout(RETRIEVAL_TIMEOUT_SECONDS):
            visible = await resolve_visible_golden_record(
                entities_client,
                golden_record_id=golden_record_id,
                accountable_institution_id=user.accountable_institution_id,
                expected_entity_type=entity_type,
            )
            data = visible.details
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GoldenRecordVisibilityError as exc:
        return JSONResponse(
            status_code=exc.http_status,
            content={"success": False, "error": exc.public_message},
            headers=_NO_STORE_HEADERS,
        )
    except (EntityServiceError, TimeoutError):
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": UPSTREAM_UNAVAILABLE_MESSAGE},
            headers=_NO_STORE_HEADERS,
        )

    return JSONResponse(content={"message": "OK", "data": data}, headers=_NO_STORE_HEADERS)
