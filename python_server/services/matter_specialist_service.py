"""Estate-context and representative-assignment writes for a transfer.

Both entrypoints accept a caller-supplied Golden Record id, so both follow the
same fixed ordering as ``transfer_party_service.link_party_to_transfer`` — the
recipe mandated by the Deedly S2S Integration Guide (2026-09-03) §6:

1. The route has already authorised the transfer locally.
2. Derive ``accountable_institution_id`` from the parent transfer row, never
   from the request body.
3. Assert Golden Record visibility (users-service linkage, then the typed
   entities fetch) with **no database transaction open**.
4. Open a short transaction, re-check the parent transfer's tenant, then insert.

``_create_with_visible_person`` is the single implementation of that ordering
for this module, so the two routes cannot drift apart. There is no unscoped
fallback: a rejected or indeterminate visibility result propagates as
``GoldenRecordVisibilityError`` and nothing is written.

Only ``golden_record_id`` values are persisted here — never any part of the
fetched Golden Record. Neither of these tables carries a display cache.
"""

import re
from typing import Any, Awaitable, Callable, Optional
from uuid import UUID

import db
from clients.entities import EntitiesClient
from repositories.matter_specialist_contexts import (
    find_active_capacity,
    find_estate_context_target,
    find_transfer_party_target,
    insert_estate_context,
    insert_representative_assignment,
)
from services.golden_record_visibility import (
    VisibleGoldenRecord,
    resolve_visible_golden_record,
)

# Guide §6.2 / migration 021: capacity is constrained by what is being represented.
ESTATE_CONTEXT_CAPACITIES = frozenset({"executor", "masters_representative"})
TRUST_PARTY_CAPACITY = "trustee"

# The represented party must be the trust itself; trustees represent it.
TRUST_ENTITY_TYPE = "trust"

# Deliberately permissive: the canonical Master's estate reference format has not
# been confirmed (see the contract doc's outstanding questions), so this rejects
# only clearly unusable values — empty, over-long, or containing control
# characters — rather than guessing a pattern that could block valid references.
MASTERS_ESTATE_REFERENCE_MAX_LENGTH = 100
_MASTERS_ESTATE_REFERENCE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/\-. ]*$")


class MatterSpecialistServiceError(Exception):
    """A domain rejection carrying the status the route should return.

    ``status_code`` is 400 for a bad request, 404 when the parent transfer or a
    represented target is not visible in the transfer's tenant, and 409 when the
    parent transfer changed underneath the request.
    """

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.public_message = message


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
        raise MatterSpecialistServiceError("Parent transfer not found", status_code=404)
    return result.rows[0]["accountable_institution_id"]


async def _create_with_visible_person(
    transfer_id: UUID,
    golden_record_id: Any,
    *,
    entities_client: EntitiesClient,
    persist: Callable[[Any, VisibleGoldenRecord, int], Awaitable[Optional[dict]]],
) -> Optional[dict]:
    """Run the mandated ordering, then hand the open transaction to ``persist``.

    ``persist(connection, visible, accountable_institution_id)`` is called only
    after the Golden Record has been proven visible to the parent transfer's
    tenant and that tenant has been re-confirmed inside the transaction.
    """
    accountable_institution_id = await _get_parent_accountable_institution_id(transfer_id)

    # No transaction is open here, by design (guide §5.4).
    visible = await resolve_visible_golden_record(
        entities_client,
        golden_record_id=golden_record_id,
        accountable_institution_id=accountable_institution_id,
        expected_entity_type="person",
    )

    async def _do_persist(connection: Any) -> Optional[dict]:
        current = await _get_parent_accountable_institution_id(
            transfer_id, connection=connection
        )
        if current != accountable_institution_id:
            raise MatterSpecialistServiceError(
                "Transfer was modified concurrently", status_code=409
            )
        return await persist(connection, visible, accountable_institution_id)

    return await db.with_transaction(_do_persist)


def normalise_masters_estate_reference(value: Any) -> Optional[str]:
    """Validate and trim an optional Master's estate reference.

    Returns None when the field was omitted or null. Raises
    ``MatterSpecialistServiceError`` for a value that is present but unusable.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise MatterSpecialistServiceError("masters_estate_reference must be a string")

    trimmed = value.strip()
    if not trimmed:
        raise MatterSpecialistServiceError("masters_estate_reference must not be blank")
    if len(trimmed) > MASTERS_ESTATE_REFERENCE_MAX_LENGTH:
        raise MatterSpecialistServiceError(
            "masters_estate_reference is too long "
            f"(maximum {MASTERS_ESTATE_REFERENCE_MAX_LENGTH} characters)"
        )
    if not _MASTERS_ESTATE_REFERENCE_PATTERN.match(trimmed):
        raise MatterSpecialistServiceError("masters_estate_reference format is invalid")
    return trimmed


async def create_estate_context(
    transfer_id: UUID,
    deceased_golden_record_id: Any,
    *,
    masters_estate_reference: Any = None,
    entities_client: EntitiesClient,
    actor_user_id: Optional[int] = None,
) -> Optional[dict]:
    """Create a matter estate context for an already-authorised transfer.

    ``deceased_golden_record_id`` must resolve to a person Golden Record that is
    a client of the transfer's accountable institution.
    """
    reference = normalise_masters_estate_reference(masters_estate_reference)

    async def _persist(connection, visible, accountable_institution_id):
        return await insert_estate_context(
            transfer_id=transfer_id,
            deceased_golden_record_id=visible.golden_record_id,
            masters_estate_reference=reference,
            accountable_institution_id=accountable_institution_id,
            actor_user_id=actor_user_id,
            connection=connection,
        )

    return await _create_with_visible_person(
        transfer_id,
        deceased_golden_record_id,
        entities_client=entities_client,
        persist=_persist,
    )


def _validate_single_target(
    represented_estate_context_id: Any, represented_transfer_party_id: Any
) -> None:
    supplied = [
        value
        for value in (represented_estate_context_id, represented_transfer_party_id)
        if value is not None
    ]
    if len(supplied) != 1:
        raise MatterSpecialistServiceError(
            "Exactly one of represented_estate_context_id or "
            "represented_transfer_party_id is required"
        )


async def create_representative_assignment(
    transfer_id: UUID,
    person_golden_record_id: Any,
    capacity: Any,
    *,
    represented_estate_context_id: Any = None,
    represented_transfer_party_id: Any = None,
    entities_client: EntitiesClient,
    actor_user_id: Optional[int] = None,
) -> Optional[dict]:
    """Assign a person, in a capacity, to represent an estate context or a trust party.

    Capacity rules (guide §6.2): representing a ``matter_estate_context`` requires
    ``executor`` or ``masters_representative``; representing a ``transfer_party``
    requires that party to be a ``trust`` and the capacity to be ``trustee``.
    Capacity never confers signing authority — that is out of scope here.
    """
    if not isinstance(capacity, str) or not capacity.strip():
        raise MatterSpecialistServiceError("capacity is required")
    capacity = capacity.strip()

    _validate_single_target(represented_estate_context_id, represented_transfer_party_id)

    represents_estate_context = represented_estate_context_id is not None
    if represents_estate_context:
        if capacity not in ESTATE_CONTEXT_CAPACITIES:
            raise MatterSpecialistServiceError(
                "capacity must be one of "
                f"{', '.join(sorted(ESTATE_CONTEXT_CAPACITIES))} "
                "when representing an estate context"
            )
    elif capacity != TRUST_PARTY_CAPACITY:
        raise MatterSpecialistServiceError(
            f"capacity must be '{TRUST_PARTY_CAPACITY}' when representing a transfer party"
        )

    if not await find_active_capacity(capacity):
        raise MatterSpecialistServiceError("Unknown or inactive capacity")

    async def _persist(connection, visible, accountable_institution_id):
        # The represented target is re-resolved inside the transaction, scoped to
        # the transfer and its tenant, so a target from another matter or tenant
        # is indistinguishable from one that does not exist.
        if represents_estate_context:
            target = await find_estate_context_target(
                estate_context_id=represented_estate_context_id,
                transfer_id=transfer_id,
                accountable_institution_id=accountable_institution_id,
                connection=connection,
            )
            if target is None:
                raise MatterSpecialistServiceError(
                    "Represented estate context not found", status_code=404
                )
        else:
            target = await find_transfer_party_target(
                transfer_party_id=represented_transfer_party_id,
                transfer_id=transfer_id,
                accountable_institution_id=accountable_institution_id,
                connection=connection,
            )
            if target is None:
                raise MatterSpecialistServiceError(
                    "Represented transfer party not found", status_code=404
                )
            if target["entity_type"] != TRUST_ENTITY_TYPE:
                raise MatterSpecialistServiceError(
                    "A represented transfer party must be a trust"
                )

        return await insert_representative_assignment(
            transfer_id=transfer_id,
            person_golden_record_id=visible.golden_record_id,
            capacity=capacity,
            represented_estate_context_id=represented_estate_context_id,
            represented_transfer_party_id=represented_transfer_party_id,
            accountable_institution_id=accountable_institution_id,
            actor_user_id=actor_user_id,
            connection=connection,
        )

    return await _create_with_visible_person(
        transfer_id,
        person_golden_record_id,
        entities_client=entities_client,
        persist=_persist,
    )
