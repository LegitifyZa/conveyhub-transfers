"""Internal service for attaching Golden Record parties to transfers.

This service does not call the Entities HTTP API and does not decide
permissions. It resolves the parent transfer's accountable institution and
coordinates short, safe database transactions.
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

import db
from repositories.transfer_parties import (
    insert_transfer_party,
    refresh_transfer_party_cache_by_id,
    refresh_transfer_party_cache_by_key,
)


class TransferPartyServiceError(Exception):
    """Raised for domain-level errors such as a missing parent transfer."""

    pass


async def _get_parent_accountable_institution_id(transfer_id: UUID) -> int:
    """Return the accountable_institution_id from the already-authorised transfer."""
    result = await db.query(
        "SELECT accountable_institution_id FROM transfers WHERE id = $1",
        [transfer_id],
    )
    if not result.rows:
        raise TransferPartyServiceError("Parent transfer not found")
    return result.rows[0]["accountable_institution_id"]


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
    """Attach a resolved Golden Record entity to a transfer.

    The transfer's accountable_institution_id is fetched from the parent
    transfers table; it is never accepted from the party request payload.
    """
    accountable_institution_id = await _get_parent_accountable_institution_id(transfer_id)

    async def _do_attach(connection: Any) -> Optional[dict]:
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

    return await db.with_transaction(_do_attach)


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
