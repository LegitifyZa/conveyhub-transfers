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
    synced_at, created_at, updated_at
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
            synced_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
