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

from datetime import datetime, timezone
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


class MatterConflictError(MatterServiceError):
    """The expected row version no longer matches the stored row."""

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


_MATTER_READ_COLUMNS = """
    id, reference_number, matter_type, title, status, firm_reference,
    classification_code, accountable_institution_id, created_at, updated_at
""".strip()

_FIRM_REFERENCE_MAX_LEN = 100
_TITLE_MAX_LEN = 255


async def update_core_matter_fields(
    *,
    transfer_id: str,
    accountable_institution_id: int,
    expected_updated_at: str,
    expected_matter_updated_at: str,
    fields: dict,
) -> tuple[dict, dict]:
    """Update the editable core fields of a transfer matter.

    Only the keys present in `fields` are written; an absent key means
    "unchanged". `None` clears a nullable matter field (firm_reference,
    title); property_address is NOT NULL and rejects blank values.

    The linked matter is resolved deterministically through
    transfers.matter_id — never by guessing between legacy source_record_id
    matches. A missing or inconsistent link fails the whole transaction.

    Both expected timestamps are required and verified against the locked
    rows, so a concurrent edit to EITHER transfers or matters (including a
    matter-only edit) is detected: BEFORE UPDATE triggers on both tables
    (migrations 001/003) maintain each row's updated_at. The expected values
    are ISO 8601 strings parsed here to timestamptz parameters — a naive
    value is assumed UTC; a malformed value is a validation error, never a
    silent conflict. Rows are locked transfers-then-matters, the same order
    as create, and check-then-write is atomic under the lock.

    Returns (transfer row, matter row).
    """

    def _expected_timestamp(value: str, name: str) -> datetime:
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError):
            raise MatterValidationError(f"{name} must be an ISO 8601 timestamp") from None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    expected_transfer_ts = _expected_timestamp(expected_updated_at, "expected_updated_at")
    expected_matter_ts = _expected_timestamp(expected_matter_updated_at, "expected_matter_updated_at")
    transfer_updates: dict = {}
    matter_updates: dict = {}

    if "property_address" in fields:
        value = fields["property_address"]
        if not isinstance(value, str) or not value.strip():
            raise MatterValidationError("property_address must be a non-empty string")
        transfer_updates["property_address"] = value.strip()

    if "firm_reference" in fields:
        value = fields["firm_reference"]
        if value is not None:
            if not isinstance(value, str):
                raise MatterValidationError("firm_reference must be a string or null")
            value = value.strip() or None
            if value is not None and len(value) > _FIRM_REFERENCE_MAX_LEN:
                raise MatterValidationError(
                    f"firm_reference must be at most {_FIRM_REFERENCE_MAX_LEN} characters"
                )
        matter_updates["firm_reference"] = value

    if "title" in fields:
        value = fields["title"]
        if value is not None:
            if not isinstance(value, str):
                raise MatterValidationError("title must be a string or null")
            value = value.strip() or None
            if value is not None and len(value) > _TITLE_MAX_LEN:
                raise MatterValidationError(
                    f"title must be at most {_TITLE_MAX_LEN} characters"
                )
        matter_updates["title"] = value

    if not transfer_updates and not matter_updates:
        raise MatterValidationError("At least one editable field is required")

    async def _do_update(connection: Any) -> tuple[dict, dict]:
        transfer_result = await db.query(
            f"""
            SELECT {_TRANSFER_READ_COLUMNS}
            FROM transfers
            WHERE id = $1 AND accountable_institution_id = $2
            FOR UPDATE
            """,
            [transfer_id, accountable_institution_id],
            connection=connection,
        )
        if not transfer_result.rows:
            raise MatterServiceError("Transfer not found")
        transfer = dict(transfer_result.rows[0])

        if transfer.get("matter_id") is None:
            raise MatterServiceError("Transfer has no linked matter")

        matter_result = await db.query(
            f"""
            SELECT {_MATTER_READ_COLUMNS}
            FROM matters
            WHERE id = $1 AND accountable_institution_id = $2
            FOR UPDATE
            """,
            [transfer["matter_id"], accountable_institution_id],
            connection=connection,
        )
        if not matter_result.rows or matter_result.rows[0]["matter_type"] != "transfer":
            raise MatterServiceError("Linked matter not found")
        matter = dict(matter_result.rows[0])

        transfer_fresh = await db.query(
            "SELECT 1 FROM transfers WHERE id = $1 AND updated_at = $2",
            [transfer_id, expected_transfer_ts],
            connection=connection,
        )
        if not transfer_fresh.rows:
            raise MatterConflictError("Transfer was modified by another user")

        matter_fresh = await db.query(
            "SELECT 1 FROM matters WHERE id = $1 AND updated_at = $2",
            [matter["id"], expected_matter_ts],
            connection=connection,
        )
        if not matter_fresh.rows:
            raise MatterConflictError("Matter was modified by another user")

        if transfer_updates:
            set_clause = ", ".join(
                f"{column} = ${index + 1}"
                for index, column in enumerate(transfer_updates)
            )
            updated = await db.query(
                f"""
                UPDATE transfers SET {set_clause}
                WHERE id = ${len(transfer_updates) + 1}
                RETURNING {_TRANSFER_READ_COLUMNS}
                """,
                [*transfer_updates.values(), transfer_id],
                connection=connection,
            )
            transfer = dict(updated.rows[0])

        if matter_updates:
            set_clause = ", ".join(
                f"{column} = ${index + 1}"
                for index, column in enumerate(matter_updates)
            )
            updated = await db.query(
                f"""
                UPDATE matters SET {set_clause}
                WHERE id = ${len(matter_updates) + 1}
                RETURNING {_MATTER_READ_COLUMNS}
                """,
                [*matter_updates.values(), matter["id"]],
                connection=connection,
            )
            matter = dict(updated.rows[0])

        return transfer, matter

    return await db.with_transaction(_do_update)
