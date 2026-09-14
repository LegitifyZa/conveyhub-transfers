"""Internal repository for transfer_parties persistence.

This module never calls the Entities service. It only performs short,
transaction-scoped SQL operations on the transfers.transfer_parties table.
"""

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from db import QueryResult, query


CACHED_COLUMNS = ("cached_name", "cached_id_number", "cached_email", "synced_at")

_READ_COLUMNS = """
    id, transfer_id, golden_record_id, entity_type, role,
    accountable_institution_id, cached_name, cached_id_number, cached_email,
    synced_at, party_source, manual_name, manual_id_number, manual_id_type,
    manual_passport_country, manual_email,
    manual_phone, manual_address, is_primary_contact, client_request_id,
    request_fingerprint, acknowledged_duplicate, created_at, updated_at
""".strip()


def _to_dict(row: Any) -> Optional[dict]:
    """Convert an asyncpg record or dict into a plain dict."""
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    return dict(row)


async def insert_transfer_party(
    transfer_id: UUID,
    golden_record_id: UUID,
    entity_type: str,
    role: str,
    accountable_institution_id: int,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
    is_primary_contact: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
    acknowledged_duplicate: bool = False,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Idempotently attach a Golden Record entity to a transfer.

    Uses ON CONFLICT (transfer_id, golden_record_id, role) DO NOTHING and,
    if the row already existed, re-selects the existing row by the same unique
    key. The caller is responsible for providing the parent transfer's
    accountable_institution_id.

    Returns the created or pre-existing transfer_party row as a dict, or None
    if the row could not be created/resolved.
    """
    # Note: the schema currently allows the same golden_record_id to be attached
    # in multiple different roles. Valid role combinations are a later business
    # rule decision; this repository does not constrain them.
    insert_sql = f"""
        INSERT INTO transfer_parties (
            transfer_id,
            golden_record_id,
            entity_type,
            role,
            accountable_institution_id,
            cached_name,
            cached_id_number,
            cached_email,
            synced_at,
            party_source,
            is_primary_contact,
            client_request_id,
            request_fingerprint,
            acknowledged_duplicate
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'golden_record', $10, $11, $12, $13)
        ON CONFLICT (transfer_id, golden_record_id, role)
        DO NOTHING
        RETURNING {_READ_COLUMNS}
    """

    insert_result = await query(
        insert_sql,
        [
            transfer_id,
            golden_record_id,
            entity_type,
            role,
            accountable_institution_id,
            cached_name,
            cached_id_number,
            cached_email,
            synced_at,
            is_primary_contact,
            client_request_id,
            request_fingerprint,
            acknowledged_duplicate,
        ],
        connection=connection,
    )

    if insert_result.rows:
        return _to_dict(insert_result.rows[0])

    # Another request won the race. Re-select the existing relationship.
    select_sql = f"""
        SELECT {_READ_COLUMNS}
        FROM transfer_parties
        WHERE transfer_id = $1
          AND golden_record_id = $2
          AND role = $3
    """

    select_result = await query(
        select_sql,
        [transfer_id, golden_record_id, role],
        connection=connection,
    )

    if select_result.rows:
        return _to_dict(select_result.rows[0])

    return None


async def find_transfer_party_by_client_request(
    accountable_institution_id: int,
    client_request_id: UUID,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Return the party row created for an institution-scoped request key."""
    select_sql = f"""
        SELECT {_READ_COLUMNS}
        FROM transfer_parties
        WHERE accountable_institution_id = $1
          AND client_request_id = $2
    """
    result = await query(
        select_sql,
        [accountable_institution_id, client_request_id],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None


async def insert_manual_transfer_party(
    transfer_id: UUID,
    entity_type: str,
    role: str,
    accountable_institution_id: int,
    *,
    manual_name: str,
    manual_id_number: Optional[str] = None,
    manual_id_type: Optional[str] = None,
    manual_passport_country: Optional[str] = None,
    manual_email: Optional[str] = None,
    manual_phone: Optional[str] = None,
    manual_address: Optional[str] = None,
    is_primary_contact: bool = False,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
    acknowledged_duplicate: bool = False,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Insert an institution-owned manual party row.

    The source discriminator is written explicitly; the database CHECK rejects
    manual rows that carry a golden_record_id or a non-person entity type. This
    function performs no upstream call and no deduplication: distinct manual
    identities are always distinct rows.
    """
    insert_sql = f"""
        INSERT INTO transfer_parties (
            transfer_id,
            golden_record_id,
            entity_type,
            role,
            accountable_institution_id,
            party_source,
            manual_name,
            manual_id_number,
            manual_id_type,
            manual_passport_country,
            manual_email,
            manual_phone,
            manual_address,
            is_primary_contact,
            client_request_id,
            request_fingerprint,
            acknowledged_duplicate
        )
        VALUES ($1, NULL, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING {_READ_COLUMNS}
    """

    insert_result = await query(
        insert_sql,
        [
            transfer_id,
            entity_type,
            role,
            accountable_institution_id,
            manual_name,
            manual_id_number,
            manual_id_type,
            manual_passport_country,
            manual_email,
            manual_phone,
            manual_address,
            is_primary_contact,
            client_request_id,
            request_fingerprint,
            acknowledged_duplicate,
        ],
        connection=connection,
    )

    return _to_dict(insert_result.rows[0]) if insert_result.rows else None


async def refresh_transfer_party_cache_by_id(
    transfer_party_id: UUID,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
    connection: Optional[Any] = None,
) -> QueryResult:
    """Update only the display cache and synced_at for a transfer_party row.

    This helper intentionally cannot change transfer_id, golden_record_id,
    role, or accountable_institution_id.
    """
    update_sql = f"""
        UPDATE transfer_parties
        SET
            cached_name = $2,
            cached_id_number = $3,
            cached_email = $4,
            synced_at = $5,
            updated_at = NOW()
        WHERE id = $1
        RETURNING {_READ_COLUMNS}
    """

    return await query(
        update_sql,
        [transfer_party_id, cached_name, cached_id_number, cached_email, synced_at],
        connection=connection,
    )


async def refresh_transfer_party_cache_by_key(
    transfer_id: UUID,
    golden_record_id: UUID,
    role: str,
    *,
    cached_name: Optional[str] = None,
    cached_id_number: Optional[str] = None,
    cached_email: Optional[str] = None,
    synced_at: Optional[datetime] = None,
    connection: Optional[Any] = None,
) -> QueryResult:
    """Update the display cache and synced_at using the unique relationship key."""
    update_sql = f"""
        UPDATE transfer_parties
        SET
            cached_name = $4,
            cached_id_number = $5,
            cached_email = $6,
            synced_at = $7,
            updated_at = NOW()
        WHERE transfer_id = $1
          AND golden_record_id = $2
          AND role = $3
        RETURNING {_READ_COLUMNS}
    """

    return await query(
        update_sql,
        [transfer_id, golden_record_id, role, cached_name, cached_id_number, cached_email, synced_at],
        connection=connection,
    )
