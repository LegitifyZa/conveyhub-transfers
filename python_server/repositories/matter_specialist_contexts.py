"""Internal repository for matter_estate_contexts and representative_assignments.

Like ``repositories.transfer_parties``, this module never calls a Legitify
service. It only performs short, transaction-scoped SQL against the
migration-020 specialist tables. Callers must have asserted Golden Record
visibility before invoking any insert here.

``accountable_institution_id`` is passed explicitly even though both tables
carry a BEFORE INSERT trigger that anchors it to the parent transfer: the
column is NOT NULL, and stating the tenant makes the caller's intent auditable
rather than relying on the trigger alone.
"""

from typing import Any, Optional
from uuid import UUID

from db import query

ESTATE_CONTEXT_COLUMNS = """
    id, transfer_id, deceased_golden_record_id, masters_estate_reference,
    created_at, updated_at
""".strip()

REPRESENTATIVE_ASSIGNMENT_COLUMNS = """
    id, transfer_id, person_golden_record_id, capacity,
    represented_transfer_party_id, represented_estate_context_id,
    created_at, updated_at
""".strip()


def _to_dict(row: Any) -> Optional[dict]:
    if row is None:
        return None
    return dict(row)


async def insert_estate_context(
    *,
    transfer_id: UUID,
    deceased_golden_record_id: UUID,
    masters_estate_reference: Optional[str],
    accountable_institution_id: int,
    actor_user_id: Optional[int],
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await query(
        f"""
        INSERT INTO matter_estate_contexts (
            transfer_id,
            deceased_golden_record_id,
            masters_estate_reference,
            accountable_institution_id,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        RETURNING {ESTATE_CONTEXT_COLUMNS}
        """,
        [
            transfer_id,
            deceased_golden_record_id,
            masters_estate_reference,
            accountable_institution_id,
            actor_user_id,
        ],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None


async def insert_representative_assignment(
    *,
    transfer_id: UUID,
    person_golden_record_id: UUID,
    capacity: str,
    represented_estate_context_id: Optional[UUID],
    represented_transfer_party_id: Optional[UUID],
    accountable_institution_id: int,
    actor_user_id: Optional[int],
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Insert an assignment. ``assignment_state`` is never accepted from a caller.

    The table's chk_representative_assignment_single_target constraint enforces
    exactly one represented target; callers should reject the invalid
    combinations before reaching this point so the caller gets a 400 rather than
    a constraint violation.
    """
    result = await query(
        f"""
        INSERT INTO representative_assignments (
            transfer_id,
            person_golden_record_id,
            capacity,
            represented_estate_context_id,
            represented_transfer_party_id,
            accountable_institution_id,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING {REPRESENTATIVE_ASSIGNMENT_COLUMNS}
        """,
        [
            transfer_id,
            person_golden_record_id,
            capacity,
            represented_estate_context_id,
            represented_transfer_party_id,
            accountable_institution_id,
            actor_user_id,
        ],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None


async def find_active_capacity(
    capacity: str, *, connection: Optional[Any] = None
) -> Optional[dict]:
    """Resolve an active representative-capacity definition code (reference data)."""
    result = await query(
        """
        SELECT code
        FROM representative_capacity_definitions
        WHERE code = $1 AND is_active = TRUE
        """,
        [capacity],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None


async def find_estate_context_target(
    *,
    estate_context_id: UUID,
    transfer_id: UUID,
    accountable_institution_id: int,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Resolve a represented estate context inside the transfer's own tenant."""
    result = await query(
        """
        SELECT id
        FROM matter_estate_contexts
        WHERE id = $1 AND transfer_id = $2 AND accountable_institution_id = $3
        """,
        [estate_context_id, transfer_id, accountable_institution_id],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None


async def find_transfer_party_target(
    *,
    transfer_party_id: UUID,
    transfer_id: UUID,
    accountable_institution_id: int,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    """Resolve a represented transfer party, with its entity_type, inside the tenant."""
    result = await query(
        """
        SELECT id, entity_type
        FROM transfer_parties
        WHERE id = $1 AND transfer_id = $2 AND accountable_institution_id = $3
        """,
        [transfer_party_id, transfer_id, accountable_institution_id],
        connection=connection,
    )
    return _to_dict(result.rows[0]) if result.rows else None
