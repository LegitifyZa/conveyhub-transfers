import enum
from dataclasses import dataclass, field
from typing import Any, Optional, cast

from clients.entities import EntitiesClient, EntityServiceError


class ReconciliationStatus(enum.Enum):
    MATCHED = "matched"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"


@dataclass
class ReconciliationResult:
    status: ReconciliationStatus
    entity: Optional[dict] = None
    candidate_count: Optional[int] = None


@dataclass
class PersonSearch:
    id_number: Optional[str] = None
    passport_number: Optional[str] = None
    passport_country: Optional[str] = None

    def __post_init__(self):
        for value in (self.id_number, self.passport_number, self.passport_country):
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError("Identity fields must be non-empty strings")
        has_id = self.id_number is not None
        has_passport = self.passport_number is not None and self.passport_country is not None
        has_any_passport = self.passport_number is not None or self.passport_country is not None

        if has_id and has_any_passport:
            raise ValueError(
                "Only one of id_number or (passport_number + passport_country) may be provided"
            )
        if not has_id and not has_passport:
            raise ValueError(
                "Exactly one of id_number or (passport_number + passport_country) must be provided"
            )

    def to_search_payload(self) -> dict[str, Any]:
        return {
            "entity_type": "person",
            "query": cast(str, self.id_number if self.id_number is not None else self.passport_number).strip(),
            "limit": 50,
            "offset": 0,
        }


class EntityReconciliationError(Exception):
    """Raised for local reconciliation failures or unsupported flows."""

    pass


class EntityReconciliationService:
    """Internal orchestration for Golden Record search/reconcile.

    This service never performs a submit; it only searches, classifies, and
    fetches a single unambiguous match. It is not exposed as a route.
    """

    def __init__(self, entities_client: EntitiesClient) -> None:
        self._client = entities_client

    async def reconcile_company(self) -> ReconciliationResult:
        """Company/trust reconciliation is not yet supported."""
        raise EntityReconciliationError(
            "Company/trust reconciliation is not supported; creation runtime remains deferred"
        )

    async def reconcile_person(self, search: PersonSearch) -> ReconciliationResult:
        """Search the Golden Record for a person and return a single canonical match.

        Raises:
            EntityReconciliationError: for invalid search inputs or unexpected response shapes.
            EntityServiceError: for remote service failures (sanitised; no PII in messages).
        """
        payload = search.to_search_payload()

        search_data = await self._client.search_entities(payload)
        candidates = _extract_results(search_data)

        if candidates is None:
            raise EntityReconciliationError("Search response did not contain a result list")

        if not candidates:
            return ReconciliationResult(
                status=ReconciliationStatus.NOT_FOUND,
                candidate_count=0,
            )

        if len(candidates) > 1:
            return ReconciliationResult(
                status=ReconciliationStatus.AMBIGUOUS,
                candidate_count=len(candidates),
            )

        candidate = candidates[0]
        entity_id = _extract_entity_id(candidate)
        if not entity_id:
            raise EntityReconciliationError("Search result did not include an entity id")

        canonical = await self._client.get_entity(entity_id, "person")
        return ReconciliationResult(
            status=ReconciliationStatus.MATCHED,
            entity=canonical,
            candidate_count=1,
        )


def _extract_results(search_data: Any) -> Optional[list]:
    """Return the list of search candidates from a search response envelope.

    Accepts either a list or a dict with a 'results' list.
    Returns None for other shapes.
    """
    if isinstance(search_data, list):
        return search_data
    if isinstance(search_data, dict):
        results = search_data.get("results")
        if isinstance(results, list):
            return results
    return None


def _extract_entity_id(candidate: Any) -> Optional[str]:
    """Return the candidate identifier without surfacing PII in messages."""
    if not isinstance(candidate, dict):
        return None
    for key in ("id", "golden_record_id", "entity_id"):
        value = candidate.get(key)
        if isinstance(value, str) and value:
            return value
    return None
