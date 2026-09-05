"""Tenant-safe Golden Record search (DEEDLY MVP 0).

``POST /api/v1/entities/search`` is unscoped by tenant (guide §4), so upstream
candidates are never returned directly. Every candidate id is passed through
``services.golden_record_visibility.resolve_visible_golden_record`` — linkage
before entity fetch, never any other order — and only records that resolve as
clients of the caller's accountable institution leave this module.

Person is the only entity type whose upstream search payload is contracted.
Company and trust are accepted structurally and answered with a controlled
``unsupported`` result; their dispatch slots into ``search`` without changing
the route contract once the payload definitions arrive.
"""

import enum
from dataclasses import dataclass, field
from typing import Optional

from clients.entities import SUPPORTED_ENTITY_TYPES, EntitiesClient
from services.entity_reconciliation import (
    EntityReconciliationError,
    PersonSearch,
    _extract_entity_id,
    _extract_results,
)
from services.golden_record_visibility import (
    GoldenRecordVisibilityError,
    VisibleGoldenRecord,
    resolve_visible_golden_record,
)

UNSUPPORTED_SEARCH_MESSAGE = (
    "Search is not yet available for this entity type: upstream search contract pending"
)

# Entity types with a contracted upstream search payload. Person only.
_SEARCHABLE_ENTITY_TYPES = frozenset({"person"})


class SearchStatus(enum.Enum):
    MATCHED = "matched"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"
    UNSUPPORTED = "unsupported"


@dataclass(frozen=True)
class GoldenRecordCandidate:
    """The tenant-visible, display-approved projection of a search hit.

    Only ``golden_record_id`` plus the guide §7.5 display cache (name,
    id_number, email) may leave this boundary; the full upstream entity is used
    for the visibility decision and then discarded.
    """

    golden_record_id: str
    entity_type: str
    name: Optional[str]
    id_number: Optional[str]
    email: Optional[str]


@dataclass
class GoldenRecordSearchResult:
    status: SearchStatus
    entity_type: str
    record: Optional[GoldenRecordCandidate] = None
    candidates: list = field(default_factory=list)
    detail: Optional[str] = None


def _to_candidate(visible: VisibleGoldenRecord) -> GoldenRecordCandidate:
    cache = visible.display_cache
    return GoldenRecordCandidate(
        golden_record_id=str(visible.golden_record_id),
        entity_type=visible.entity_type,
        name=cache.name,
        id_number=cache.id_number,
        email=cache.email,
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
        id_number: Optional[str] = None,
        passport_number: Optional[str] = None,
        passport_country: Optional[str] = None,
    ) -> GoldenRecordSearchResult:
        """Dispatch by entity type. Raises ``ValueError`` for invalid local input."""
        if entity_type not in SUPPORTED_ENTITY_TYPES:
            raise ValueError("entity_type must be one of 'person', 'company' or 'trust'")

        if entity_type not in _SEARCHABLE_ENTITY_TYPES:
            # Company/trust payloads are not yet contracted upstream; answer
            # with a controlled result rather than guessing a request shape.
            return GoldenRecordSearchResult(
                status=SearchStatus.UNSUPPORTED,
                entity_type=entity_type,
                detail=UNSUPPORTED_SEARCH_MESSAGE,
            )

        return await self._search_person(
            accountable_institution_id=accountable_institution_id,
            id_number=id_number,
            passport_number=passport_number,
            passport_country=passport_country,
        )

    async def _search_person(
        self,
        *,
        accountable_institution_id: int,
        id_number: Optional[str],
        passport_number: Optional[str],
        passport_country: Optional[str],
    ) -> GoldenRecordSearchResult:
        # PersonSearch raises ValueError when the identity path is invalid.
        search = PersonSearch(
            id_number=id_number,
            passport_number=passport_number,
            passport_country=passport_country,
        )

        search_data = await self._client.search_entities(search.to_search_payload())
        candidates = _extract_results(search_data)
        if candidates is None:
            raise EntityReconciliationError("Search response did not contain a result list")

        candidate_ids: list = []
        seen: set = set()
        for candidate in candidates:
            candidate_id = _extract_entity_id(candidate)
            if not candidate_id:
                raise EntityReconciliationError("Search result did not include an entity id")
            if candidate_id not in seen:
                seen.add(candidate_id)
                candidate_ids.append(candidate_id)

        # Tenant safety: every candidate must independently prove visibility
        # through the linkage endpoint before it can be returned.
        visible: list = []
        for candidate_id in candidate_ids:
            try:
                record = await resolve_visible_golden_record(
                    self._client,
                    golden_record_id=candidate_id,
                    accountable_institution_id=accountable_institution_id,
                    expected_entity_type="person",
                )
            except ValueError as exc:
                raise EntityReconciliationError(
                    "Search result did not include a usable entity id"
                ) from exc
            except GoldenRecordVisibilityError as exc:
                if exc.is_rejection:
                    continue
                raise
            visible.append(record)

        if not visible:
            return GoldenRecordSearchResult(
                status=SearchStatus.NOT_FOUND, entity_type="person"
            )

        if len(visible) == 1:
            return GoldenRecordSearchResult(
                status=SearchStatus.MATCHED,
                entity_type="person",
                record=_to_candidate(visible[0]),
            )

        return GoldenRecordSearchResult(
            status=SearchStatus.AMBIGUOUS,
            entity_type="person",
            candidates=[_to_candidate(record) for record in visible],
        )
