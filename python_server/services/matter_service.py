"""Internal service for creating DEEDLY transfer matters.

Creates the transfers row plus its matters row (matter_type='transfer',
source_record_id back-link) in a single short transaction, mirroring the
legacy create shape. The accountable_institution_id is supplied by the caller
from the verified caller context (or an explicitly resolved cross-tenant
selection); it is never taken from unvalidated request data.

When a client_request_id is supplied, creation is idempotent per institution:
a repeated request with the same key and payload returns the existing
transfer, while reuse with a different payload raises
MatterIdempotencyConflictError. A foreign institution's identical key is an
independent request by design.
"""

from decimal import Decimal
from typing import Any, Optional, Union
from uuid import UUID

import asyncpg

import db


class MatterServiceError(Exception):
    """Raised for domain-level matter creation errors."""

    pass


class MatterValidationError(MatterServiceError):
    """Raised when the create payload is invalid."""

    pass


class MatterIdempotencyConflictError(MatterServiceError):
    """A client_request_id was reused with a different payload."""

    pass


_TRANSFER_READ_COLUMNS = """
    id, transfer_id, property_address, purchase_price, status,
    current_step, total_steps, progress, matter_id,
    accountable_institution_id, client_request_id, request_fingerprint,
    created_at, updated_at
""".strip()


async def _find_transfer_by_client_request(
    accountable_institution_id: int,
    client_request_id: UUID,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {_TRANSFER_READ_COLUMNS}
        FROM transfers
        WHERE accountable_institution_id = $1
          AND client_request_id = $2
        """,
        [accountable_institution_id, client_request_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def create_transfer_matter(
    *,
    property_address: str,
    purchase_price: Union[int, float, Decimal],
    accountable_institution_id: int,
    actor_user_id: int,
    firm_reference: Optional[str] = None,
    classification_code: Optional[str] = None,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
) -> tuple[dict, bool]:
    """Create a transfer matter; returns (transfer row, created flag).

    'in_progress' is the only open lifecycle status permitted by migration 016;
    'complete' is reached by later workflow transitions, never by creation.
    """
    if not isinstance(property_address, str) or not property_address.strip():
        raise MatterValidationError("property_address is required")
    try:
        price = Decimal(str(purchase_price))
    except Exception:
        raise MatterValidationError("purchase_price must be a number") from None
    if not price.is_finite() or price < 0:
        raise MatterValidationError("purchase_price must be a non-negative number")

    created = False

    async def _do_create(connection: Any) -> dict:
        nonlocal created
        if client_request_id is not None:
            existing = await _find_transfer_by_client_request(
                accountable_institution_id, client_request_id, connection=connection
            )
            if existing is not None:
                if existing.get("request_fingerprint") == request_fingerprint:
                    return existing
                raise MatterIdempotencyConflictError(
                    "client_request_id was already used with a different payload"
                )

        insert_result = await db.query(
            f"""
            INSERT INTO transfers (
                transfer_id, property_address, purchase_price, status,
                current_step, total_steps, progress,
                accountable_institution_id, created_by_user_id,
                client_request_id, request_fingerprint
            )
            VALUES (generate_transfer_id(), $1, $2, 'in_progress', 1, 5, 0, $3, $4, $5, $6)
            RETURNING {_TRANSFER_READ_COLUMNS}
            """,
            [
                property_address.strip(),
                price,
                accountable_institution_id,
                actor_user_id,
                client_request_id,
                request_fingerprint,
            ],
            connection=connection,
        )
        transfer = dict(insert_result.rows[0])

        matter_result = await db.query(
            """
            INSERT INTO matters (
                reference_number, matter_type, title, status,
                source_record_id, accountable_institution_id,
                firm_reference, classification_code
            )
            VALUES ($1, 'transfer', $2, 'in_progress', $3, $4, $5, $6)
            RETURNING id
            """,
            [
                transfer["transfer_id"],
                f"Transfer {transfer['transfer_id']}",
                str(transfer["id"]),
                accountable_institution_id,
                firm_reference,
                classification_code,
            ],
            connection=connection,
        )
        matter_id = matter_result.rows[0]["id"]

        await db.query(
            "UPDATE transfers SET matter_id = $2 WHERE id = $1",
            [transfer["id"], matter_id],
            connection=connection,
        )
        transfer["matter_id"] = matter_id
        created = True
        return transfer

    try:
        row = await db.with_transaction(_do_create)
    except asyncpg.UniqueViolationError:
        if client_request_id is not None:
            existing = await _find_transfer_by_client_request(
                accountable_institution_id, client_request_id
            )
            if existing is not None:
                if existing.get("request_fingerprint") == request_fingerprint:
                    return existing, False
                raise MatterIdempotencyConflictError(
                    "client_request_id was already used with a different payload"
                ) from None
        raise

    return row, created
