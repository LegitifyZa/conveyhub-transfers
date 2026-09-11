"""Tenant-scoped Golden Record visibility (Deedly S2S Integration Guide §6, 2026-09-03).

Entities does not enforce accountable-institution visibility for S2S callers,
so Deedly asserts it here, in this order and never any other:

1. The caller has already authorised the transfer locally and derived
   ``accountable_institution_id`` from the transfer row (not from the request).
2. ``GET /api/v1/users/clients/s2s/by-golden-record/{gr}?accountable_institution_id={ai}``
   — 404 means "unknown or inaccessible Golden Record"; fail closed.
3. Only after step 2 succeeds:
   ``GET /api/v1/entities/{gr}?entity_type=person|company`` — trusts use company.
   Validate returned type and trust classification; 404 or unusable records fail closed.

There is no fallback to an unscoped lookup, no retry without the AI filter, and
no database transaction may be open while these calls are in flight.

Two traps the guide calls out explicitly:

- **Never substitute ``tenant_id`` equality for step 2.** A Golden Record fetched
  in step 3 carries a ``tenant_id``, but records are shared across tenants by
  design (the same person can be a client of many accountable institutions), so
  comparing it is not a correct visibility test. The linkage endpoint exists to
  avoid exactly this trap.
- **Linkage is asserted through ``users.clients``** — "this Golden Record is a
  client of this AI". That is the correct test for conveyancing parties (buyers,
  sellers, deceased estates, trustees). It will not match staff members or
  Golden Records that exist only as transaction related-parties. If a legitimate
  flow ever needs one of those, raise it upstream rather than widening the check.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional, Union
from uuid import UUID

from clients.entities import SUPPORTED_ENTITY_TYPES, EntitiesClient, EntityServiceError

NOT_VISIBLE_MESSAGE = "Unknown or inaccessible Golden Record"
UPSTREAM_UNAVAILABLE_MESSAGE = "Golden Record service unavailable"

_REJECTED_REASONS = frozenset({"not_visible", "type_mismatch_or_missing", "inactive"})
_UNUSABLE_STATUSES = frozenset({"inactive", "deleted", "archived"})


class GoldenRecordVisibilityError(Exception):
    """Raised when a Golden Record may not be linked to the transfer's tenant.

    ``reason`` is one of:

    - ``not_visible``: linkage endpoint returned 404 (unknown GR or not a client of this AI;
      deliberately indistinguishable).
    - ``type_mismatch_or_missing``: entities returned 404 for the expected ``entity_type``,
      or the returned record's type does not match.
    - ``inactive``: the record exists and is visible but is not usable.
    - ``upstream_unavailable``: a Legitify service failed (5xx, timeout, network).
    - ``invalid_response``: a 200 response did not have the expected shape.

    Rejections map to HTTP 400 with a tenant-safe message; upstream failures map
    to HTTP 503 and must never be reported as a tenant decision.
    """

    def __init__(
        self,
        reason: str,
        *,
        operation: Optional[str] = None,
        status_code: Optional[int] = None,
    ) -> None:
        super().__init__(f"Golden Record visibility check failed: {reason}")
        self.reason = reason
        self.operation = operation
        self.status_code = status_code

    @property
    def is_rejection(self) -> bool:
        return self.reason in _REJECTED_REASONS

    @property
    def http_status(self) -> int:
        return 400 if self.is_rejection else 503

    @property
    def public_message(self) -> str:
        return NOT_VISIBLE_MESSAGE if self.is_rejection else UPSTREAM_UNAVAILABLE_MESSAGE


@dataclass(frozen=True)
class DisplayCache:
    """The only Golden Record fields Deedly persists locally, alongside ``golden_record_id``.

    Guide §7.5: a trusted first-party caller receives the full record, but must
    minimise what it stores — ``golden_record_id`` plus name / id_number / email
    and ``synced_at``. Everything else is used for the visibility decision and
    then discarded.
    """

    name: Optional[str]
    id_number: Optional[str]
    email: Optional[str]


@dataclass(frozen=True)
class VisibleGoldenRecord:
    golden_record_id: UUID
    entity_type: str
    accountable_institution_id: int
    entity: dict
    linkage: dict
    synced_at: datetime

    @property
    def display_cache(self) -> DisplayCache:
        return DisplayCache(
            name=_display_name(self.entity),
            id_number=_display_id_number(self.entity),
            email=_display_email(self.entity),
        )

    @property
    def details(self) -> dict:
        cache = self.display_cache
        data = {
            "goldenRecordId": str(self.golden_record_id),
            "entityType": self.entity_type,
            "name": cache.name,
            "idNumber": cache.id_number,
            "email": cache.email,
            "phone": _text(self.entity, "cellphone" if self.entity_type == "person" else "phone_number"),
            "address": _display_address(self.entity, self.entity_type),
        }
        if self.entity_type in {"company", "trust"}:
            data.update(
                registrationNo=_text(self.entity, "registration_no") or _text(self.entity, "registration_number"),
                mastersOffice=_text(self.entity, "masters_office"),
                isTrust=self.entity_type == "trust",
            )
        return data


def _validate_inputs(
    golden_record_id: Union[UUID, str],
    accountable_institution_id: int,
    expected_entity_type: str,
) -> UUID:
    if not isinstance(expected_entity_type, str) or expected_entity_type not in SUPPORTED_ENTITY_TYPES:
        raise ValueError("expected_entity_type must be one of 'person', 'company' or 'trust'")
    if (
        isinstance(accountable_institution_id, bool)
        or not isinstance(accountable_institution_id, int)
        or accountable_institution_id <= 0
    ):
        raise ValueError("accountable_institution_id must be a positive integer")
    if isinstance(golden_record_id, UUID):
        return golden_record_id
    try:
        return UUID(str(golden_record_id))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ValueError("golden_record_id must be a UUID") from exc


async def resolve_visible_golden_record(
    client: EntitiesClient,
    *,
    golden_record_id: Union[UUID, str],
    accountable_institution_id: int,
    expected_entity_type: str,
) -> VisibleGoldenRecord:
    """Assert that ``golden_record_id`` is a client of ``accountable_institution_id`` and fetch it.

    Callers must pass the accountable institution derived from the already
    authorised transfer, as the integer ``users.accountable_institutions`` id —
    never a tenant UUID and never a value taken from the request body. Raises
    ``GoldenRecordVisibilityError`` on any negative or indeterminate outcome;
    never falls back to an unscoped lookup and never retries without the AI
    filter. The returned entity is for the visibility decision and the display
    cache only; nothing else about it may be persisted.
    """
    gr_id = _validate_inputs(golden_record_id, accountable_institution_id, expected_entity_type)

    try:
        linkage = await client.get_client_by_golden_record(str(gr_id), accountable_institution_id)
    except EntityServiceError as exc:
        if exc.is_not_found:
            raise GoldenRecordVisibilityError(
                "not_visible", operation=exc.operation, status_code=exc.status_code
            ) from exc
        raise GoldenRecordVisibilityError(
            "upstream_unavailable", operation=exc.operation, status_code=exc.status_code
        ) from exc

    if (
        not isinstance(linkage, dict)
        or type(linkage.get("id")) is not int
        or linkage["id"] <= 0
        or type(linkage.get("accountable_institution_id")) is not int
        or linkage["accountable_institution_id"] != accountable_institution_id
    ):
        raise GoldenRecordVisibilityError(
            "invalid_response", operation="get_client_by_golden_record"
        )
    _validate_response_id(linkage.get("golden_record_id"), gr_id, "get_client_by_golden_record")

    retrieval_type = "company" if expected_entity_type == "trust" else expected_entity_type
    try:
        entity = await client.get_entity(str(gr_id), retrieval_type)
    except EntityServiceError as exc:
        if exc.is_not_found:
            raise GoldenRecordVisibilityError(
                "type_mismatch_or_missing", operation=exc.operation, status_code=exc.status_code
            ) from exc
        raise GoldenRecordVisibilityError(
            "upstream_unavailable", operation=exc.operation, status_code=exc.status_code
        ) from exc

    if not isinstance(entity, dict):
        raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")

    _validate_response_id(entity.get("id"), gr_id, "get_entity")

    returned_type = entity.get("entity_type")
    if expected_entity_type == "trust":
        if returned_type != "company" or entity.get("is_trust") is not True:
            raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")
    else:
        if "entity_type" in entity:
            if not isinstance(returned_type, str) or not returned_type:
                raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")
            if returned_type != retrieval_type:
                raise GoldenRecordVisibilityError("type_mismatch_or_missing", operation="get_entity")
        elif expected_entity_type == "company":
            raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")
        if (expected_entity_type == "company" or "is_trust" in entity) and entity.get("is_trust") is not False:
            raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")

    for key in (
        "display_name", "full_name", "legal_name", "name", "registered_name", "first_name", "surname", "last_name",
        "id_number", "passport_number", "registration_no", "registration_number", "email", "masters_office",
        "status", "deleted_at",
    ):
        _text(entity, key)
    for key in ("is_active", "is_deleted"):
        if entity.get(key) is not None and not isinstance(entity[key], bool):
            raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")

    if not _is_usable(entity):
        raise GoldenRecordVisibilityError("inactive", operation="get_entity")

    return VisibleGoldenRecord(
        golden_record_id=gr_id,
        entity_type=expected_entity_type,
        accountable_institution_id=accountable_institution_id,
        entity=entity,
        linkage=linkage,
        synced_at=datetime.now(timezone.utc),
    )


def _is_usable(entity: dict) -> bool:
    if entity.get("is_active") is False:
        return False
    if entity.get("is_deleted") is True:
        return False
    if entity.get("deleted_at") is not None:
        return False
    status = entity.get("status")
    if isinstance(status, str) and status.strip().lower() in _UNUSABLE_STATUSES:
        return False
    return True


def _clean(value: Any) -> Optional[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _display_name(entity: dict) -> Optional[str]:
    for key in ("display_name", "full_name", "legal_name", "name", "registered_name"):
        value = _clean(entity.get(key))
        if value:
            return value
    parts = [p for p in (
        _clean(entity.get("first_name")),
        _clean(entity.get("surname")) or _clean(entity.get("last_name")),
    ) if p]
    return " ".join(parts) or None


def _display_id_number(entity: dict) -> Optional[str]:
    for key in ("id_number", "passport_number", "registration_no", "registration_number"):
        value = _clean(entity.get(key))
        if value:
            return value
    return None


def _display_email(entity: dict) -> Optional[str]:
    return _clean(entity.get("email"))


def _validate_response_id(value: Any, expected: UUID, operation: str) -> None:
    if not isinstance(value, str):
        raise GoldenRecordVisibilityError("invalid_response", operation=operation)
    try:
        matches = UUID(value) == expected
    except (ValueError, TypeError) as exc:
        raise GoldenRecordVisibilityError("invalid_response", operation=operation) from exc
    if not matches:
        raise GoldenRecordVisibilityError("invalid_response", operation=operation)


def _text(entity: dict, key: str) -> Optional[str]:
    value = entity.get(key)
    if value is not None and not isinstance(value, str):
        raise GoldenRecordVisibilityError("invalid_response", operation="get_entity")
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeError as exc:
            raise GoldenRecordVisibilityError("invalid_response", operation="get_entity") from exc
    return _clean(value)


def _display_address(entity: dict, entity_type: str) -> Optional[str]:
    keys = (
        "residential_address_line1", "residential_address_line2", "residential_city",
        "residential_province", "residential_postal_code", "residential_country",
    ) if entity_type == "person" else (
        "office_address", "office_city", "office_province", "office_postal_code",
    )
    parts = [_text(entity, key) for key in keys]
    full_address = _text(entity, "residential_address") if entity_type == "person" else None
    return full_address or ", ".join(part for part in parts if part) or None
