"""Internal service for attaching Golden Record parties to transfers.

This service does not decide route-level permissions: callers must have
authorised the transfer first (existing ``_authorize_transfer`` pattern).
``link_party_to_transfer`` is the only entrypoint that accepts a
caller-supplied ``golden_record_id``: it derives the tenant from the parent
transfer, asserts Golden Record visibility through the Legitify client while
no database transaction is open, and then persists the party in a short
transaction that re-checks the parent. Only ``golden_record_id`` plus the
approved display cache (name / id_number / email + synced_at) is stored.
"""

from datetime import datetime
from typing import Any, Optional, Union
from uuid import UUID

import asyncpg

import db
from auth.current_user import is_positive_integer
from clients.entities import EntitiesClient
from repositories.transfer_parties import (
    find_transfer_party_by_client_request,
    insert_manual_transfer_party,
    insert_transfer_party,
    refresh_transfer_party_cache_by_id,
    refresh_transfer_party_cache_by_key,
)
from services.golden_record_visibility import resolve_visible_golden_record


class TransferPartyServiceError(Exception):
    """Raised for domain-level errors such as a missing parent transfer."""

    pass


class PartyValidationError(TransferPartyServiceError):
    """Raised when a party payload has an invalid source/field combination."""

    pass


class PartyConflictError(TransferPartyServiceError):
    """Raised when a party violates a non-idempotency unique constraint."""

    pass


class IdempotencyConflictError(TransferPartyServiceError):
    """A client_request_id was reused with a different payload."""

    pass


def _fingerprint_matches(existing: dict, request_fingerprint: Optional[str]) -> bool:
    return existing.get("request_fingerprint") == request_fingerprint


async def _resolve_client_request_replay(
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Return the existing row for a repeated request, or raise on payload reuse.

    The lookup is scoped to the parent matter's institution so a foreign
    institution's request id can neither observe nor collide with this row.
    """
    if client_request_id is None:
        return None
    existing = await find_transfer_party_by_client_request(
        accountable_institution_id, client_request_id, connection=connection
    )
    if existing is None:
        return None
    if _fingerprint_matches(existing, request_fingerprint):
        return existing
    raise IdempotencyConflictError(
        "client_request_id was already used with a different payload"
    )


async def _replay_or_conflict_after_unique_violation(
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
) -> Optional[dict]:
    """Handle a lost unique-key race after the transaction has rolled back.

    The insert losing the race means the winner's row now exists: return it for
    a true replay, surface an idempotency conflict for a different payload, or
    report a non-idempotency conflict (e.g. the one-primary-per-role rule).
    """
    if client_request_id is not None:
        existing = await find_transfer_party_by_client_request(
            accountable_institution_id, client_request_id
        )
        if existing is not None:
            if _fingerprint_matches(existing, request_fingerprint):
                return existing
            raise IdempotencyConflictError(
                "client_request_id was already used with a different payload"
            )
    raise PartyConflictError(
        "Party conflicts with an existing relationship or primary-contact rule"
    )


async def _get_parent_accountable_institution_id(
    transfer_id: UUID, *, connection: Optional[Any] = None
) -> int:
    """Return the accountable_institution_id from the already-authorised transfer."""
    result = await db.query(
        "SELECT accountable_institution_id FROM transfers WHERE id = $1"
        + (" FOR UPDATE" if connection is not None else ""),
        [transfer_id],
        connection=connection,
    )
    if not result.rows:
        raise TransferPartyServiceError("Parent transfer not found")
    ai = result.rows[0]["accountable_institution_id"]
    if not is_positive_integer(ai):
        raise TransferPartyServiceError("Parent transfer has no authorised institution")
    return ai


async def _persist_party(
    transfer_id: UUID,
    golden_record_id: UUID,
    entity_type: str,
    role: str,
    accountable_institution_id: int,
    *,
    cached_name: Optional[str],
    cached_id_number: Optional[str],
    cached_email: Optional[str],
    synced_at: Optional[datetime],
    is_primary_contact: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
    acknowledged_duplicate: bool = False,
) -> Optional[dict]:
    """Short transaction: re-check the parent transfer, then insert the party row.

    When a client_request_id is supplied, an earlier request with the same key
    and payload resolves to the existing row; reuse with a different payload
    raises IdempotencyConflictError.
    """

    async def _do_persist(connection: Any) -> Optional[dict]:
        current_ai = await _get_parent_accountable_institution_id(
            transfer_id, connection=connection
        )
        if current_ai != accountable_institution_id:
            raise TransferPartyServiceError("Parent transfer tenant changed")
        replayed = await _resolve_client_request_replay(
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
            connection=connection,
        )
        if replayed is not None:
            return replayed
        return await insert_transfer_party(
            transfer_id=transfer_id,
            golden_record_id=golden_record_id,
            entity_type=entity_type,
            role=role,
            accountable_institution_id=accountable_institution_id,
            cached_name=cached_name,
            cached_id_number=cached_id_number,
            cached_email=cached_email,
            synced_at=synced_at,
            is_primary_contact=is_primary_contact,
            client_request_id=client_request_id,
            request_fingerprint=request_fingerprint,
            acknowledged_duplicate=acknowledged_duplicate,
            connection=connection,
        )

    try:
        return await db.with_transaction(_do_persist)
    except asyncpg.UniqueViolationError:
        return await _replay_or_conflict_after_unique_violation(
            accountable_institution_id, client_request_id, request_fingerprint
        )


async def link_party_to_transfer(
    transfer_id: UUID,
    golden_record_id: Union[UUID, str],
    entity_type: str,
    role: str,
    *,
    entities_client: EntitiesClient,
    is_primary_contact: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
    acknowledged_duplicate: bool = False,
) -> Optional[dict]:
    """Link a caller-supplied Golden Record to an already-authorised transfer.

    Order is fixed: derive the tenant from the parent transfer, assert
    visibility (users-service linkage, then the typed entities fetch) with no
    transaction open, then open a short transaction that re-checks the parent
    and inserts the party with the display cache taken from the fetched record.

    Raises ``TransferPartyServiceError`` for parent-transfer problems and
    ``GoldenRecordVisibilityError`` when the Golden Record is unknown,
    inaccessible, of the wrong type, unusable, or the upstream check failed.
    """
    accountable_institution_id = await _get_parent_accountable_institution_id(transfer_id)

    visible = await resolve_visible_golden_record(
        entities_client,
        golden_record_id=golden_record_id,
        accountable_institution_id=accountable_institution_id,
        expected_entity_type=entity_type,
    )
    cache = visible.display_cache

    return await _persist_party(
        transfer_id,
        visible.golden_record_id,
        entity_type,
        role,
        accountable_institution_id,
        cached_name=cache.name,
        cached_id_number=cache.id_number,
        cached_email=cache.email,
        synced_at=visible.synced_at,
        is_primary_contact=is_primary_contact,
        client_request_id=client_request_id,
        request_fingerprint=request_fingerprint,
        acknowledged_duplicate=acknowledged_duplicate,
    )


async def attach_manual_party_to_transfer(
    transfer_id: UUID,
    *,
    entity_type: str,
    role: str,
    manual_name: str,
    manual_id_number: Optional[str] = None,
    manual_id_type: Optional[str] = None,
    manual_passport_country: Optional[str] = None,
    manual_email: Optional[str] = None,
    manual_phone: Optional[str] = None,
    manual_address: Optional[str] = None,
    is_primary_contact: bool = False,
    acknowledged_duplicate: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
) -> Optional[dict]:
    """Persist an institution-owned manual party on an authorised transfer.

    This entrypoint performs no upstream call: manual capture never creates or
    updates Golden Records and implies no verification. The tenant is derived
    from the parent transfer and re-checked inside a short transaction, exactly
    like the Golden Record path. ``entity_type`` is explicit and limited to
    natural persons in this slice.
    """
    if entity_type != "person":
        raise PartyValidationError(
            "Manual capture currently supports natural persons only"
        )
    if not isinstance(manual_name, str) or not manual_name.strip():
        raise PartyValidationError("manual name is required")
    if manual_id_type is not None and manual_id_type not in ("sa_id", "passport", "other"):
        raise PartyValidationError("manual id_type must be 'sa_id', 'passport' or 'other'")
    if manual_passport_country is not None and manual_id_type != "passport":
        raise PartyValidationError("manual passport_country requires id_type 'passport'")

    accountable_institution_id = await _get_parent_accountable_institution_id(transfer_id)

    async def _do_persist(connection: Any) -> Optional[dict]:
        current_ai = await _get_parent_accountable_institution_id(
            transfer_id, connection=connection
        )
        if current_ai != accountable_institution_id:
            raise TransferPartyServiceError("Parent transfer tenant changed")
        replayed = await _resolve_client_request_replay(
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
            connection=connection,
        )
        if replayed is not None:
            return replayed
        return await insert_manual_transfer_party(
            transfer_id,
            entity_type,
            role,
            accountable_institution_id,
            manual_name=manual_name.strip(),
            manual_id_number=manual_id_number,
            manual_id_type=manual_id_type,
            manual_passport_country=manual_passport_country,
            manual_email=manual_email,
            manual_phone=manual_phone,
            manual_address=manual_address,
            is_primary_contact=is_primary_contact,
            client_request_id=client_request_id,
            request_fingerprint=request_fingerprint,
            acknowledged_duplicate=acknowledged_duplicate,
            connection=connection,
        )

    try:
        return await db.with_transaction(_do_persist)
    except asyncpg.UniqueViolationError:
        return await _replay_or_conflict_after_unique_violation(
            accountable_institution_id, client_request_id, request_fingerprint
        )


async def attach_party_to_transfer(
    transfer_id: UUID,
    golden_record_id: UUID,
    entity_type: str,
    role: str,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
    is_primary_contact: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
    acknowledged_duplicate: bool = False,
) -> Optional[dict]:
    """Persist an already visibility-validated Golden Record party.

    This is the persistence step only; it performs no Entities call. Routes
    handling a caller-supplied golden_record_id must use
    ``link_party_to_transfer`` instead. The transfer's
    accountable_institution_id is fetched from the parent transfers table and
    re-checked inside the transaction; it is never accepted from the payload.
    """
    accountable_institution_id = await _get_parent_accountable_institution_id(transfer_id)

    return await _persist_party(
        transfer_id,
        golden_record_id,
        entity_type,
        role,
        accountable_institution_id,
        cached_name=cached_name,
        cached_id_number=cached_id_number,
        cached_email=cached_email,
        synced_at=synced_at,
        is_primary_contact=is_primary_contact,
        client_request_id=client_request_id,
        request_fingerprint=request_fingerprint,
        acknowledged_duplicate=acknowledged_duplicate,
    )


async def _get_party_context(transfer_party_id: UUID, *, connection: Optional[Any] = None) -> dict:
    result = await db.query(
        """
        SELECT tp.transfer_id, tp.golden_record_id, tp.entity_type, tp.accountable_institution_id
        FROM transfer_parties tp
        JOIN transfers t ON t.id = tp.transfer_id
          AND t.accountable_institution_id = tp.accountable_institution_id
        WHERE tp.id = $1
        """ + (" FOR UPDATE OF t, tp" if connection is not None else ""),
        [transfer_party_id],
        connection=connection,
    )
    if not result.rows:
        raise TransferPartyServiceError("Transfer party not found")
    row = dict(result.rows[0])
    if not is_positive_integer(row["accountable_institution_id"]):
        raise TransferPartyServiceError("Transfer party has no authorised institution")
    return row


async def refresh_party_cache_from_golden_record(
    transfer_party_id: UUID,
    *,
    entities_client: EntitiesClient,
) -> Any:
    """Re-fetch the party's Golden Record and refresh only the display cache.

    Used where staleness matters (party detail / compliance views). The same
    visibility recipe applies as for linking: the row's own
    accountable_institution_id scopes the linkage check, and the fetch happens
    before the short update transaction.
    """
    row = await _get_party_context(transfer_party_id)

    visible = await resolve_visible_golden_record(
        entities_client,
        golden_record_id=row["golden_record_id"],
        accountable_institution_id=row["accountable_institution_id"],
        expected_entity_type=row["entity_type"],
    )
    cache = visible.display_cache

    async def _do_refresh(connection: Any) -> Any:
        current = await _get_party_context(transfer_party_id, connection=connection)
        if current != row:
            raise TransferPartyServiceError("Transfer party context changed")
        return await refresh_transfer_party_cache_by_id(
            transfer_party_id,
            cached_name=cache.name,
            cached_id_number=cache.id_number,
            cached_email=cache.email,
            synced_at=visible.synced_at,
            connection=connection,
        )

    return await db.with_transaction(_do_refresh)


async def refresh_cache_by_transfer_party_id(
    transfer_party_id: UUID,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
) -> Any:
    """Refresh the cache for a single transfer_party row in a short transaction."""

    async def _do_refresh(connection: Any) -> Any:
        return await refresh_transfer_party_cache_by_id(
            transfer_party_id,
            cached_name=cached_name,
            cached_id_number=cached_id_number,
            cached_email=cached_email,
            synced_at=synced_at,
            connection=connection,
        )

    return await db.with_transaction(_do_refresh)


async def refresh_cache_by_relationship_key(
    transfer_id: UUID,
    golden_record_id: UUID,
    role: str,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
) -> Any:
    """Refresh the cache for a unique (transfer, golden_record, role) relationship."""

    async def _do_refresh(connection: Any) -> Any:
        return await refresh_transfer_party_cache_by_key(
            transfer_id,
            golden_record_id,
            role,
            cached_name=cached_name,
            cached_id_number=cached_id_number,
            cached_email=cached_email,
            synced_at=synced_at,
            connection=connection,
        )

    return await db.with_transaction(_do_refresh)
