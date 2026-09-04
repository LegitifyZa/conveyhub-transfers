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

import db
from clients.entities import EntitiesClient
from repositories.transfer_parties import (
    insert_transfer_party,
    refresh_transfer_party_cache_by_id,
    refresh_transfer_party_cache_by_key,
)
from services.golden_record_visibility import resolve_visible_golden_record


class TransferPartyServiceError(Exception):
    """Raised for domain-level errors such as a missing parent transfer."""

    pass


async def _get_parent_accountable_institution_id(
    transfer_id: UUID, *, connection: Optional[Any] = None
) -> int:
    """Return the accountable_institution_id from the already-authorised transfer."""
    result = await db.query(
        "SELECT accountable_institution_id FROM transfers WHERE id = $1",
        [transfer_id],
        connection=connection,
    )
    if not result.rows:
        raise TransferPartyServiceError("Parent transfer not found")
    return result.rows[0]["accountable_institution_id"]


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
) -> Optional[dict]:
    """Short transaction: re-check the parent transfer, then insert the party row."""

    async def _do_persist(connection: Any) -> Optional[dict]:
        current_ai = await _get_parent_accountable_institution_id(
            transfer_id, connection=connection
        )
        if current_ai != accountable_institution_id:
            raise TransferPartyServiceError("Parent transfer tenant changed")
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
            connection=connection,
        )

    return await db.with_transaction(_do_persist)


async def link_party_to_transfer(
    transfer_id: UUID,
    golden_record_id: Union[UUID, str],
    entity_type: str,
    role: str,
    *,
    entities_client: EntitiesClient,
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
    )


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
    result = await db.query(
        """
        SELECT golden_record_id, entity_type, accountable_institution_id
        FROM transfer_parties
        WHERE id = $1
        """,
        [transfer_party_id],
    )
    if not result.rows:
        raise TransferPartyServiceError("Transfer party not found")
    row = result.rows[0]

    visible = await resolve_visible_golden_record(
        entities_client,
        golden_record_id=row["golden_record_id"],
        accountable_institution_id=row["accountable_institution_id"],
        expected_entity_type=row["entity_type"],
    )
    cache = visible.display_cache

    return await refresh_cache_by_transfer_party_id(
        transfer_party_id,
        cached_name=cache.name,
        cached_id_number=cache.id_number,
        cached_email=cache.email,
        synced_at=visible.synced_at,
    )


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
