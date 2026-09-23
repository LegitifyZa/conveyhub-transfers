"""Internal service for DEEDLY matter–property capture, linking and readback.

Owns the canonical matter_properties relationship for the v1 property slice:

- link_existing_property_to_matter: attaches an active, same-institution
  properties row to the transfer's linked matter (property_kind='input').
- capture_and_link_property_to_matter: creates an institution-private manual
  property record and links it atomically — a link failure rolls the property
  back so no orphan row can survive.
- list_matter_properties: allow-listed link+property readback. Existing links
  stay readable regardless of the property's current status.

Deterministic matter resolution: the matter is reached only through
transfers.matter_id (validated matter_type='transfer' + same institution).
Missing or inconsistent links fail closed; prototype rows are never repaired.

Idempotency (migration 024): client_request_id is unique per institution on
both tables. A matching fingerprint replays the original rows; conflicting
reuse raises PropertyIdempotencyConflictError. The fingerprint is target-bound
(operation + transfer + matter + validated payload). Replay is checked BEFORE
new-link eligibility, so a stored link still resolves if the property later
became inactive — eligibility constrains new links, never history.

This service never writes transfers.property_id, matters.property_id or
transfers.property_address, and never performs upstream calls. Manual capture
is institution-private and unverified: source_system='manual_capture' marks
the provenance; external_property_id / registry fields are never invented.
"""

import re
from typing import Any, Optional
from uuid import UUID

import asyncpg

import db


class MatterPropertyServiceError(Exception):
    """Raised for domain-level matter–property errors (mapped to 404)."""

    pass


class PropertyValidationError(MatterPropertyServiceError):
    """Raised when a property capture/link payload is invalid (422)."""

    pass


class PropertyNotEligibleError(MatterPropertyServiceError):
    """The selected property exists but is not eligible for a new link (400)."""

    pass


class PropertyConflictError(MatterPropertyServiceError):
    """A non-idempotency state conflict (409)."""

    pass


class PropertyIdempotencyConflictError(MatterPropertyServiceError):
    """A client_request_id was reused with a different payload (409)."""

    pass


# Allow-listed projections — never expose every column. request_fingerprint
# is read back solely for server-side idempotency comparison; response
# mappers do not emit it.
PROPERTY_READ_COLUMNS = """
    id, property_id, erf_number, street_address, suburb, city, postal_code,
    province, country, property_type, legal_description, year_built,
    square_footage, extent_sqm, status, source_system,
    accountable_institution_id, client_request_id, request_fingerprint,
    created_at, updated_at
""".strip()

LINK_READ_COLUMNS = """
    id, matter_id, property_id, property_kind, registration_status,
    role_in_matter, external_property_id, property_source,
    accountable_institution_id, client_request_id, request_fingerprint,
    created_at, updated_at
""".strip()

# The nine property_type values permitted by migration 006's CHECK.
PROPERTY_TYPES = (
    "Freehold",
    "Sectional Title",
    "Share Block",
    "Life Rights",
    "Agricultural Holding",
    "Farm",
    "Commercial",
    "Mixed Use",
    "Vacant Land",
)

CAPTURE_FIELDS = (
    "street_address",
    "suburb",
    "city",
    "postal_code",
    "province",
    "country",
    "property_type",
    "erf_number",
    "legal_description",
    "year_built",
)

_POSTAL_CODE_RE = re.compile(r"^\d{4}$")

# Manual capture marks the row institution-private and unverified. The token
# was checked against consumers before adoption: no runtime code reads
# properties.source_system (all references are matters.source_record_id, a
# different column). Verification is never inferred from external identifiers.
MANUAL_CAPTURE_SOURCE_SYSTEM = "manual_capture"


def _require_str(payload: dict, field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise PropertyValidationError(f"property.{field} is required")
    return value.strip()


def validate_capture_payload(payload: dict) -> dict:
    """Validate a manual capture payload; returns the canonical insert dict.

    Only the allow-listed CAPTURE_FIELDS are accepted. Required: street_address,
    city, province, property_type. postal_code is optional but a supplied
    non-empty value must be a valid four-digit SA postal code — malformed
    values are rejected, never silently nulled. Area capture (square_footage /
    extent_sqm) is deferred: neither key is accepted in this slice.
    """
    if not isinstance(payload, dict):
        raise PropertyValidationError("property must be an object")
    unexpected = set(payload.keys()) - set(CAPTURE_FIELDS)
    if unexpected:
        raise PropertyValidationError(
            f"Unexpected property field(s): {', '.join(sorted(unexpected))}"
        )

    validated = {
        "street_address": _require_str(payload, "street_address"),
        "city": _require_str(payload, "city"),
        "province": _require_str(payload, "province"),
        "property_type": _require_str(payload, "property_type"),
    }

    if validated["property_type"] not in PROPERTY_TYPES:
        raise PropertyValidationError("property.property_type is not a supported value")

    for field in ("suburb", "country", "erf_number", "legal_description"):
        value = payload.get(field)
        if value is None:
            continue
        if not isinstance(value, str):
            raise PropertyValidationError(f"property.{field} must be a string")
        validated[field] = value.strip() or None

    postal_code = payload.get("postal_code")
    if postal_code is not None:
        if not isinstance(postal_code, str):
            raise PropertyValidationError("property.postal_code must be a string")
        postal_code = postal_code.strip()
        if postal_code and not _POSTAL_CODE_RE.match(postal_code):
            raise PropertyValidationError(
                "property.postal_code must be a four-digit South African postal code"
            )
        validated["postal_code"] = postal_code or None

    year_built = payload.get("year_built")
    if year_built is not None:
        if isinstance(year_built, bool) or not isinstance(year_built, int):
            raise PropertyValidationError("property.year_built must be an integer")
        validated["year_built"] = year_built

    return validated


async def _resolve_matter_locked(
    transfer_id: UUID,
    accountable_institution_id: int,
    connection: Any,
) -> tuple[dict, dict]:
    """Lock the transfer and resolve its matter deterministically.

    Fails closed: a missing transfer, a NULL matter_id, or a matter that is
    missing, mistyped or institution-inconsistent all raise
    MatterPropertyServiceError. Prototype-era rows are never repaired.
    """
    transfer_result = await db.query(
        """
        SELECT id, matter_id, accountable_institution_id
        FROM transfers
        WHERE id = $1 AND accountable_institution_id = $2
        FOR UPDATE
        """,
        [transfer_id, accountable_institution_id],
        connection=connection,
    )
    if not transfer_result.rows:
        raise MatterPropertyServiceError("Transfer not found")
    transfer = dict(transfer_result.rows[0])

    if transfer.get("matter_id") is None:
        raise MatterPropertyServiceError("Transfer has no linked matter")

    matter_result = await db.query(
        """
        SELECT id, matter_type, accountable_institution_id
        FROM matters
        WHERE id = $1
          AND accountable_institution_id = $2
          AND matter_type = 'transfer'
        """,
        [transfer["matter_id"], accountable_institution_id],
        connection=connection,
    )
    if not matter_result.rows:
        raise MatterPropertyServiceError("Linked matter not found")
    return transfer, dict(matter_result.rows[0])


async def _find_link_by_client_request(
    accountable_institution_id: int,
    client_request_id: UUID,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {LINK_READ_COLUMNS}
        FROM matter_properties
        WHERE accountable_institution_id = $1
          AND client_request_id = $2
        """,
        [accountable_institution_id, client_request_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def _find_property_by_client_request(
    accountable_institution_id: int,
    client_request_id: UUID,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {PROPERTY_READ_COLUMNS}
        FROM properties
        WHERE accountable_institution_id = $1
          AND client_request_id = $2
        """,
        [accountable_institution_id, client_request_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def _find_property(
    property_id: UUID,
    accountable_institution_id: int,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {PROPERTY_READ_COLUMNS}
        FROM properties
        WHERE id = $1 AND accountable_institution_id = $2
        """,
        [property_id, accountable_institution_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def _find_link(
    matter_id: UUID,
    property_id: UUID,
    *,
    connection: Optional[Any] = None,
) -> Optional[dict]:
    result = await db.query(
        f"""
        SELECT {LINK_READ_COLUMNS}
        FROM matter_properties
        WHERE matter_id = $1
          AND property_id = $2
          AND property_kind = 'input'
        """,
        [matter_id, property_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def _insert_property(
    validated: dict,
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
    connection: Any,
) -> dict:
    result = await db.query(
        f"""
        INSERT INTO properties (
            property_id, street_address, suburb, city, postal_code, province,
            country, property_type, erf_number, legal_description, year_built,
            status, source_system, accountable_institution_id,
            client_request_id, request_fingerprint
        )
        VALUES (
            generate_property_id(), $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            'active', $11, $12, $13, $14
        )
        RETURNING {PROPERTY_READ_COLUMNS}
        """,
        [
            validated["street_address"],
            validated.get("suburb"),
            validated["city"],
            validated.get("postal_code"),
            validated["province"],
            validated.get("country") or "South Africa",
            validated["property_type"],
            validated.get("erf_number"),
            validated.get("legal_description"),
            validated.get("year_built"),
            MANUAL_CAPTURE_SOURCE_SYSTEM,
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
        ],
        connection=connection,
    )
    return dict(result.rows[0])


async def _insert_link(
    matter_id: UUID,
    property_id: UUID,
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
    connection: Any,
) -> dict:
    # accountable_institution_id is trigger-derived from the parent matter
    # (trg_matter_properties_set_tenant, migrations 018/019); the supplied
    # value matches it and is overwritten regardless.
    result = await db.query(
        f"""
        INSERT INTO matter_properties (
            matter_id, property_id, property_kind,
            accountable_institution_id, client_request_id, request_fingerprint
        )
        VALUES ($1, $2, 'input', $3, $4, $5)
        ON CONFLICT (matter_id, property_id, property_kind) DO NOTHING
        RETURNING {LINK_READ_COLUMNS}
        """,
        [
            matter_id,
            property_id,
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
        ],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def _link_after_property_resolved(
    matter: dict,
    property_row: dict,
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
    connection: Any,
) -> tuple[dict, dict, bool]:
    """Insert the input link or return the pre-existing one."""
    link = await _insert_link(
        matter["id"],
        property_row["id"],
        accountable_institution_id,
        client_request_id,
        request_fingerprint,
        connection,
    )
    if link is not None:
        return link, property_row, True
    # Natural-key conflict: the identical link already exists (a keyless or
    # lost-race request). Return it — the desired end state holds.
    existing = await _find_link(
        matter["id"], property_row["id"], connection=connection
    )
    if existing is None:
        raise PropertyConflictError("Matter–property link could not be created")
    return existing, property_row, False


async def _resolve_link_replay(
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
    connection: Any,
) -> Optional[tuple[dict, Optional[dict]]]:
    """Return (link, property) when client_request_id already stored a link.

    Raises PropertyIdempotencyConflictError on fingerprint mismatch. Replay
    resolves the original rows even if the property later became inactive —
    eligibility governs new links, not stored ones.
    """
    if client_request_id is None:
        return None
    existing = await _find_link_by_client_request(
        accountable_institution_id, client_request_id, connection=connection
    )
    if existing is None:
        return None
    if existing.get("request_fingerprint") != request_fingerprint:
        raise PropertyIdempotencyConflictError(
            "client_request_id was already used with a different payload"
        )
    property_row = None
    if existing.get("property_id") is not None:
        property_row = await _find_property(
            existing["property_id"], accountable_institution_id, connection=connection
        )
    return existing, property_row


async def link_existing_property_to_matter(
    transfer_id: UUID,
    property_id: UUID,
    accountable_institution_id: int,
    *,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
) -> tuple[dict, dict, bool]:
    """Link an active same-institution property to the transfer's matter.

    Returns (link row, property row, created). Replays return the stored rows
    after reauthorization; a subsequent status change to inactive does not
    invalidate an already-stored link.
    """
    created = False

    async def _do(connection: Any) -> tuple[dict, dict]:
        nonlocal created
        _transfer, matter = await _resolve_matter_locked(
            transfer_id, accountable_institution_id, connection
        )

        replay = await _resolve_link_replay(
            accountable_institution_id, client_request_id, request_fingerprint, connection
        )
        if replay is not None:
            return replay

        property_row = await _find_property(
            property_id, accountable_institution_id, connection=connection
        )
        if property_row is None:
            raise MatterPropertyServiceError("Property not found")
        if property_row.get("status") != "active":
            raise PropertyNotEligibleError("Property is not eligible for linking")

        link, resolved_property, was_created = await _link_after_property_resolved(
            matter,
            property_row,
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
            connection,
        )
        created = was_created
        return link, resolved_property

    try:
        link_row, property_row = await db.with_transaction(_do)
        return link_row, property_row, created
    except asyncpg.UniqueViolationError:
        resolved = await _resolve_lost_race(
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
        )
        if resolved is not None:
            return resolved[0], resolved[1], False
        raise


async def capture_and_link_property_to_matter(
    transfer_id: UUID,
    capture_payload: dict,
    accountable_institution_id: int,
    *,
    client_request_id: Optional[UUID] = None,
    request_fingerprint: Optional[str] = None,
) -> tuple[dict, dict, bool]:
    """Create a manual institution-private property and link it atomically.

    The link insert runs in the same transaction, so a link failure rolls the
    property back — no orphan rows. Returns (link row, property row, created).
    """
    validated = validate_capture_payload(capture_payload)
    created = False

    async def _do(connection: Any) -> tuple[dict, dict]:
        nonlocal created
        _transfer, matter = await _resolve_matter_locked(
            transfer_id, accountable_institution_id, connection
        )

        replay = await _resolve_link_replay(
            accountable_institution_id, client_request_id, request_fingerprint, connection
        )
        if replay is not None:
            return replay

        property_row = None
        if client_request_id is not None:
            # Defence-in-depth for a property row stored by a request whose
            # link insert never committed (impossible atomically, but the
            # lookup keeps key semantics honest if the row exists).
            prior = await _find_property_by_client_request(
                accountable_institution_id, client_request_id, connection=connection
            )
            if prior is not None:
                if prior.get("request_fingerprint") != request_fingerprint:
                    raise PropertyIdempotencyConflictError(
                        "client_request_id was already used with a different payload"
                    )
                property_row = prior

        if property_row is None:
            property_row = await _insert_property(
                validated,
                accountable_institution_id,
                client_request_id,
                request_fingerprint,
                connection,
            )

        link, resolved_property, was_created = await _link_after_property_resolved(
            matter,
            property_row,
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
            connection,
        )
        created = was_created
        return link, resolved_property

    try:
        link_row, property_row = await db.with_transaction(_do)
        return link_row, property_row, created
    except asyncpg.UniqueViolationError:
        resolved = await _resolve_lost_race(
            accountable_institution_id,
            client_request_id,
            request_fingerprint,
        )
        if resolved is not None:
            return resolved[0], resolved[1], False
        raise


async def _resolve_lost_race(
    accountable_institution_id: int,
    client_request_id: Optional[UUID],
    request_fingerprint: Optional[str],
) -> Optional[tuple[dict, Optional[dict]]]:
    """Post-rollback resolution after a unique-violation race.

    A lost race on the request key or the natural link key resolves to the
    stored rows (fingerprint-verified). There is no duplicate-on-lost-replay
    fallback: if nothing stored the key, the error propagates.
    """
    if client_request_id is None:
        return None
    link = await _find_link_by_client_request(accountable_institution_id, client_request_id)
    if link is None:
        return None
    if link.get("request_fingerprint") != request_fingerprint:
        raise PropertyIdempotencyConflictError(
            "client_request_id was already used with a different payload"
        ) from None
    property_row = None
    if link.get("property_id") is not None:
        property_row = await _find_property(
            link["property_id"], accountable_institution_id
        )
    return link, property_row


async def list_matter_properties(
    transfer_id: UUID,
    accountable_institution_id: int,
) -> list[dict]:
    """Allow-listed link + property readback for a same-institution transfer.

    Existing links are returned regardless of the linked property's current
    status, and multi-link matters return complete. output-kind rows without
    a property surface with property=None rather than being hidden.
    """
    result = await db.query(
        f"""
        SELECT
            mp.id AS link_id, mp.matter_id, mp.property_id AS link_property_id,
            mp.property_kind, mp.registration_status, mp.role_in_matter,
            mp.external_property_id, mp.property_source,
            mp.accountable_institution_id AS link_accountable_institution_id,
            mp.client_request_id AS link_client_request_id,
            mp.created_at AS link_created_at, mp.updated_at AS link_updated_at,
            p.id AS p_id, p.property_id AS p_property_id, p.erf_number AS p_erf_number,
            p.street_address AS p_street_address, p.suburb AS p_suburb,
            p.city AS p_city, p.postal_code AS p_postal_code,
            p.province AS p_province, p.country AS p_country,
            p.property_type AS p_property_type,
            p.legal_description AS p_legal_description,
            p.year_built AS p_year_built, p.square_footage AS p_square_footage,
            p.extent_sqm AS p_extent_sqm, p.status AS p_status,
            p.source_system AS p_source_system,
            p.accountable_institution_id AS p_accountable_institution_id,
            p.client_request_id AS p_client_request_id,
            p.created_at AS p_created_at, p.updated_at AS p_updated_at
        FROM matter_properties mp
        JOIN matters m
            ON m.id = mp.matter_id
           AND m.accountable_institution_id = $2
           AND m.matter_type = 'transfer'
        JOIN transfers t
            ON t.matter_id = mp.matter_id
           AND t.id = $1
           AND t.accountable_institution_id = $2
        LEFT JOIN properties p
            ON p.id = mp.property_id
           AND p.accountable_institution_id = mp.accountable_institution_id
        WHERE mp.accountable_institution_id = $2
        ORDER BY mp.created_at, mp.id
        """,
        [transfer_id, accountable_institution_id],
    )
    return [dict(row) for row in result.rows]


async def search_properties(
    accountable_institution_id: int,
    query_text: Optional[str],
    limit: int,
) -> list[dict]:
    """Same-institution property discovery for selecting a link target.

    Returns the allow-listed projection including status, so callers can see
    eligibility; only status='active' rows may be newly linked.
    """
    clauses = ["accountable_institution_id = $1"]
    params: list[Any] = [accountable_institution_id]
    if query_text:
        escaped = (
            query_text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        params.append(f"%{escaped}%")
        clauses.append(
            """(
                street_address ILIKE $2 ESCAPE '\\'
                OR city ILIKE $2 ESCAPE '\\'
                OR erf_number ILIKE $2 ESCAPE '\\'
                OR property_id ILIKE $2 ESCAPE '\\'
                OR title_deed_number ILIKE $2 ESCAPE '\\'
            )"""
        )
    params.append(limit)
    result = await db.query(
        f"""
        SELECT {PROPERTY_READ_COLUMNS}
        FROM properties
        WHERE {' AND '.join(clauses)}
        ORDER BY street_address, id
        LIMIT ${len(params)}
        """,
        params,
    )
    return [dict(row) for row in result.rows]
