"""Tenant-safe Golden Record search (DEEDLY MVP 0).

``POST /api/v1/entities/search`` is global for S2S callers omitting tenant_id.
Every candidate id is passed through
``services.golden_record_visibility.resolve_visible_golden_record`` — linkage
before entity fetch, never any other order — and only records that resolve as
clients of the caller's accountable institution leave this module.

All three search discriminators use the contracted generic query. Trusts are
retrieved as companies. Classification requires an exhausted upstream result
set; a bounded or failed search never becomes a partial match or no-match.
"""

import asyncio
import enum
from dataclasses import dataclass, field
from typing import Optional
from uuid import UUID

from clients.entities import SUPPORTED_ENTITY_TYPES, EntitiesClient, EntityServiceError
from services.entity_reconciliation import EntityReconciliationError, _extract_entity_id
from services.golden_record_visibility import (
    GoldenRecordVisibilityError,
    VisibleGoldenRecord,
    resolve_visible_golden_record,
)

SEARCH_PAGE_SIZE = 50
SEARCH_MAX_PAGES = 10
SEARCH_TIMEOUT_SECONDS = 30

# Entity types with a contracted upstream search payload.
_SEARCHABLE_ENTITY_TYPES = SUPPORTED_ENTITY_TYPES


class SearchStatus(enum.Enum):
    MATCHED = "matched"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"


@dataclass(frozen=True)
class GoldenRecordCandidate:
    """The tenant-visible, display-approved projection of a search hit.

    Display cache fields and transient company/trust disambiguation metadata
    are taken only from the canonical entity after the linkage check. Search
    metadata is never exposed or persisted as canonical identity.
    """

    golden_record_id: str
    entity_type: str
    name: Optional[str]
    id_number: Optional[str]
    email: Optional[str]
    registration_no: Optional[str] = None
    masters_office: Optional[str] = None
    is_trust: Optional[bool] = None


@dataclass
class GoldenRecordSearchResult:
    status: SearchStatus
    entity_type: str
    record: Optional[GoldenRecordCandidate] = None
    candidates: list = field(default_factory=list)
    detail: Optional[str] = None


def _to_candidate(visible: VisibleGoldenRecord) -> GoldenRecordCandidate:
    entity = visible.entity
    metadata = {}
    if visible.entity_type in {"company", "trust"}:
        registration = entity.get("registration_no") or entity.get("registration_number")
        office = entity.get("masters_office")
        metadata = {
            "registration_no": registration.strip() if isinstance(registration, str) and registration.strip() else None,
            "masters_office": office.strip() if isinstance(office, str) and office.strip() else None,
            "is_trust": entity.get("is_trust") is True,
        }
    cache = visible.display_cache
    return GoldenRecordCandidate(
        golden_record_id=str(visible.golden_record_id),
        entity_type=visible.entity_type,
        name=cache.name,
        id_number=cache.id_number,
        email=cache.email,
        **metadata,
    )


class GoldenRecordSearchService:
    """Search Golden Records and return only tenant-visible results.

    Never performs a submit. The ``accountable_institution_id`` must come from
    the authenticated request context, never from the request body.
    """

    def __init__(self, entities_client: EntitiesClient) -> None:
        self._client = entities_client

    async def search(
        self,
        *,
        entity_type: str,
        accountable_institution_id: int,
        query: str,
    ) -> GoldenRecordSearchResult:
        """Dispatch by entity type. Raises ``ValueError`` for invalid local input."""
        if not isinstance(entity_type, str) or entity_type not in _SEARCHABLE_ENTITY_TYPES:
            raise ValueError("entity_type must be one of 'person', 'company' or 'trust'")
        if (
            isinstance(accountable_institution_id, bool)
            or not isinstance(accountable_institution_id, int)
            or accountable_institution_id <= 0
        ):
            raise ValueError("accountable_institution_id must be a positive integer")
        if not isinstance(query, str) or not query.strip() or len(query.strip()) > 200:
            raise ValueError("query must be a non-empty string of at most 200 characters")
        if not query.strip().strip("%_ "):
            raise ValueError("query must contain a name or identifier")

        # Company/trust use the upstream discriminator, never a company search
        # followed by a local trust filter.
        try:
            async with asyncio.timeout(SEARCH_TIMEOUT_SECONDS):
                return await self._search(entity_type, accountable_institution_id, query.strip())
        except TimeoutError as exc:
            raise EntityReconciliationError("Search did not complete") from exc

    async def _search(
        self, entity_type: str, accountable_institution_id: int, query: str
    ) -> GoldenRecordSearchResult:
        # Exhaust the typed search before making any uniqueness claim.
        candidate_ids = []
        seen = set()
        for page in range(SEARCH_MAX_PAGES):
            try:
                candidates = await self._client.search_entities({
                    "entity_type": entity_type,
                    "query": query,
                    "limit": SEARCH_PAGE_SIZE,
                    "offset": page * SEARCH_PAGE_SIZE,
                })
            except EntityServiceError as exc:
                raise EntityReconciliationError("Search request failed") from exc
            if not isinstance(candidates, list) or len(candidates) > SEARCH_PAGE_SIZE:
                raise EntityReconciliationError("Search response did not contain a valid result page")
            for candidate in candidates:
                candidate_id = _extract_entity_id(candidate)
                try:
                    normalized = str(UUID(candidate_id)) if candidate_id else None
                except (ValueError, AttributeError, TypeError) as exc:
                    raise EntityReconciliationError("Search result did not include a usable entity id") from exc
                if normalized is None:
                    raise EntityReconciliationError("Search result did not include an entity id")
                if normalized not in seen:
                    seen.add(normalized)
                    candidate_ids.append(normalized)
            if len(candidates) < SEARCH_PAGE_SIZE:
                break
        else:
            raise EntityReconciliationError("Search did not complete within its page budget")

        # Tenant safety: every candidate must independently prove visibility
        # through the linkage endpoint before it can be returned.
        visible = []
        for candidate_id in candidate_ids:
            try:
                record = await resolve_visible_golden_record(
                    self._client,
                    golden_record_id=candidate_id,
                    accountable_institution_id=accountable_institution_id,
                    expected_entity_type=entity_type,
                )
            except GoldenRecordVisibilityError as exc:
                if exc.is_rejection:
                    continue
                raise
            visible.append(_to_candidate(record))

        if not visible:
            return GoldenRecordSearchResult(status=SearchStatus.NOT_FOUND, entity_type=entity_type)
        if len(visible) == 1:
            return GoldenRecordSearchResult(
                status=SearchStatus.MATCHED, entity_type=entity_type, record=visible[0]
            )
        return GoldenRecordSearchResult(
            status=SearchStatus.AMBIGUOUS, entity_type=entity_type, candidates=visible
        )
