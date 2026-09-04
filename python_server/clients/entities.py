"""Single Legitify service-to-service client (Deedly S2S Integration Guide, 2026-09-03).

Per guide §9, every Legitify call (entities and users services) goes through this
one module so the eventual in-cluster absorption only changes configuration: the
nginx gateway base URL and the platform ``X-Service-Key`` both come from config.

The service key means "trusted internal service" upstream — no user, no tenant,
no ability restrictions (§3.1). Callers must therefore authorise locally *before*
using any method here (§5.1); this client never enforces tenant visibility
itself, and it deliberately sends no ``X-Accountable-Institution-Id``: entities
will not accept or enforce it (§6). Tenant visibility is asserted by
``services.golden_record_visibility`` via the users-service linkage endpoint.
"""

import asyncio
from typing import Any, Awaitable, Callable, Optional

import httpx

from config import Settings

# Guide §4: entities supports person, company and trust. ``entity_type`` is
# required for companies and trusts on retrieval because the service defaults to
# person and 404s on a mismatch.
SUPPORTED_ENTITY_TYPES = frozenset({"person", "company", "trust"})

# Guide §3.3. Reads (get, search, clients linkage) get the 5-10s band; a person
# submit runs live provider lookups and gets 30s. Company/trust submits need
# 120-180s and are not implemented here: their request shapes are defined in the
# deep-dive (transfers_golden_record_providers_auth.md §2.4-§2.6), which this
# repository does not have, and no caller needs them yet.
CONNECT_TIMEOUT_SECONDS = 5.0
READ_TIMEOUT_SECONDS = 10.0
PERSON_SUBMIT_TIMEOUT_SECONDS = 30.0

# Guide §7.3: no upstream rate limits or circuit breakers on the S2S lane, so we
# bound ourselves — retry only on 5xx/timeouts, with backoff, and never hammer
# submits.
READ_MAX_ATTEMPTS = 3
SUBMIT_MAX_ATTEMPTS = 2
RETRY_BACKOFF_BASE_SECONDS = 0.25

_RETRYABLE_TRANSPORT_ERRORS = (httpx.TimeoutException, httpx.NetworkError)


class EntityServiceError(Exception):
    """Raised when a Legitify service returns an error or an unexpected shape.

    The exception message is intentionally sanitised: it contains only the
    operation name, the HTTP status, and a generic failure category. The raw
    remote response body is never retained; only a boolean flag indicating that
    a body was present is kept, plus `operation`, `status_code`, `category` and,
    for validation failures, the offending field names (never their values).

    Categories: ``not_found`` (404, tenant-safe "unknown or not linked"),
    ``validation_error`` (422), ``http_error`` (other non-2xx), ``timeout``,
    ``network``, ``malformed_json``, ``missing_data_envelope``.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: Optional[str] = None,
        status_code: Optional[int] = None,
        category: Optional[str] = None,
        response_body_present: bool = False,
        error_fields: tuple = (),
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.status_code = status_code
        self.category = category
        self.response_body_present = response_body_present
        self.error_fields = tuple(error_fields)

    @property
    def is_not_found(self) -> bool:
        return self.status_code == 404


def _read_timeout() -> httpx.Timeout:
    return httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)


def _person_submit_timeout() -> httpx.Timeout:
    return httpx.Timeout(PERSON_SUBMIT_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)


class EntitiesClient:
    """Transport for the sanctioned Legitify S2S surface (guide §4).

    ``transport`` is a test seam only: it lets the S2S contract tests drive a
    simulated gateway through the real client. Production always leaves it None.
    """

    def __init__(self, settings: Settings, *, transport: Optional[Any] = None) -> None:
        self._base_url = settings.legitify_api_base_url.rstrip("/")
        client_kwargs: dict[str, Any] = {
            "base_url": self._base_url,
            "headers": {"X-Service-Key": settings.secret_key},
        }
        if transport is not None:
            client_kwargs["transport"] = transport
        self._client = httpx.AsyncClient(**client_kwargs)

    def __repr__(self) -> str:
        return f"EntitiesClient(base_url={self._base_url!r})"

    async def get_client_by_golden_record(
        self, golden_record_id: str, accountable_institution_id: int
    ) -> Any:
        """Resolve the users.clients row linking a Golden Record to an accountable institution.

        ``GET /api/v1/users/clients/s2s/by-golden-record/{gr}?accountable_institution_id={ai}``

        This is the platform's tenant-visibility primitive (guide §4, §6): the
        users service owns the client to accountable-institution linkage, and
        entities deliberately provides no equivalent for S2S callers.

        A 404 is tenant-safe and indistinguishable between "unknown Golden
        Record" and "not linked to this AI"; it surfaces as an
        ``EntityServiceError`` with ``category="not_found"``. Per guide §7.1 the
        AI id is the integer ``users.accountable_institutions`` primary key; the
        AI's ``tenant_id`` UUID is a separate keyspace used only in submit bodies.
        """
        if (
            isinstance(accountable_institution_id, bool)
            or not isinstance(accountable_institution_id, int)
            or accountable_institution_id <= 0
        ):
            raise ValueError("accountable_institution_id must be a positive integer")

        response = await self._send(
            self._client.get,
            f"/api/v1/users/clients/s2s/by-golden-record/{golden_record_id}",
            operation="get_client_by_golden_record",
            max_attempts=READ_MAX_ATTEMPTS,
            params={"accountable_institution_id": accountable_institution_id},
            timeout=_read_timeout(),
        )
        return self._extract_data(response, operation="get_client_by_golden_record")

    async def get_entity(self, entity_id: str, entity_type: str) -> Any:
        """``GET /api/v1/entities/{id}?entity_type=...`` — the full Golden Record.

        ``entity_type`` is always sent, including for persons: the service
        defaults to person and 404s on a mismatch (guide §4), which surfaces as
        ``category="not_found"``.

        As a trusted first-party caller the response contains the full record.
        Per guide §7.5 the caller must persist only ``golden_record_id`` plus the
        approved display cache. The record's ``tenant_id`` must never be used as
        a visibility test — Golden Records are shared across tenants by design.
        """
        if entity_type not in SUPPORTED_ENTITY_TYPES:
            raise ValueError("entity_type must be one of 'person', 'company' or 'trust'")

        response = await self._send(
            self._client.get,
            f"/api/v1/entities/{entity_id}",
            operation="get_entity",
            max_attempts=READ_MAX_ATTEMPTS,
            params={"entity_type": entity_type},
            timeout=_read_timeout(),
        )
        return self._extract_data(response, operation="get_entity")

    async def search_entities(self, payload: dict) -> Any:
        """``POST /api/v1/entities/search`` — search by name/number.

        A POST with a JSON body, not query parameters (guide §4). Search results
        are unscoped by tenant, so a result must never be treated as proof that
        the caller may see the record: only ``resolve_visible_golden_record``
        decides that.
        """
        response = await self._send(
            self._client.post,
            "/api/v1/entities/search",
            operation="search_entities",
            max_attempts=READ_MAX_ATTEMPTS,
            json=payload,
            timeout=_read_timeout(),
        )
        return self._extract_data(response, operation="search_entities")

    async def submit_person(
        self,
        tenant_id: str,
        *,
        id_number: Optional[str] = None,
        passport_number: Optional[str] = None,
        passport_country: Optional[str] = None,
        **person_fields: Any,
    ) -> Any:
        """``POST /api/v1/entities/submit`` — get-or-create a person and run its lookups.

        ``tenant_id`` is the accountable institution's ``tenant_id`` UUID (guide
        §7.1, §7.2), not the integer AI id used for the linkage lookup. Submits
        are billable (guide §5 cost model) and get the 30s provider budget.

        Callers must not cache display fields from this response: per guide §8,
        always fetch the record with ``get_entity`` afterwards and cache from
        that, which also closes the known mid-orchestration race.
        """
        has_id = id_number is not None
        has_passport = passport_number is not None and passport_country is not None

        if has_id and has_passport:
            raise ValueError(
                "Only one of id_number or (passport_number + passport_country) may be provided"
            )
        if not has_id and not has_passport:
            raise ValueError(
                "Exactly one of id_number or (passport_number + passport_country) must be provided"
            )

        body: dict[str, Any] = {"tenant_id": tenant_id, **person_fields}
        if has_id:
            body["id_number"] = id_number
        else:
            body["passport_number"] = passport_number
            body["passport_country"] = passport_country

        response = await self._send(
            self._client.post,
            "/api/v1/entities/submit",
            operation="submit_person",
            max_attempts=SUBMIT_MAX_ATTEMPTS,
            json=body,
            timeout=_person_submit_timeout(),
        )
        return self._extract_data(response, operation="submit_person")

    async def _send(
        self,
        send: Callable[..., Awaitable[httpx.Response]],
        url: str,
        *,
        operation: str,
        max_attempts: int,
        **kwargs: Any,
    ) -> httpx.Response:
        """Issue a request, retrying with exponential backoff only on 5xx or transport timeouts/errors.

        4xx responses (including the tenant-safe 404) are returned immediately
        and never retried, so a scoped lookup can never be re-issued with a
        different scope.
        """
        attempt = 0
        while True:
            attempt += 1
            try:
                response = await send(url, **kwargs)
            except _RETRYABLE_TRANSPORT_ERRORS as exc:
                if attempt >= max_attempts:
                    category = "timeout" if isinstance(exc, httpx.TimeoutException) else "network"
                    raise EntityServiceError(
                        f"Entity service {operation} failed: {category}",
                        operation=operation,
                        category=category,
                    ) from exc
            else:
                if response.status_code < 500 or attempt >= max_attempts:
                    return response
            await asyncio.sleep(RETRY_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))

    def _extract_data(self, response: httpx.Response, *, operation: str) -> Any:
        """Unwrap the platform response envelope (guide §3.4).

        Every response is ``{"message": ..., "data": ...}`` with no status key,
        and validation errors add ``"errors": {field: [msgs]}``. An empty ``data``
        is ``[]`` rather than null, so a missing ``data`` key is treated as a
        malformed response rather than an empty result.
        """
        if not response.is_success:
            if response.status_code == 404:
                category = "not_found"
            elif response.status_code == 422:
                category = "validation_error"
            else:
                category = "http_error"
            raise EntityServiceError(
                f"Entity service {operation} failed with status {response.status_code}",
                operation=operation,
                status_code=response.status_code,
                category=category,
                response_body_present=True,
                error_fields=_validation_error_fields(response),
            )

        try:
            envelope = response.json()
        except Exception as exc:
            raise EntityServiceError(
                f"Entity service {operation} returned non-JSON response",
                operation=operation,
                status_code=response.status_code,
                category="malformed_json",
                response_body_present=True,
            ) from exc

        if not isinstance(envelope, dict) or "data" not in envelope:
            raise EntityServiceError(
                f"Entity service {operation} response missing 'data' envelope",
                operation=operation,
                status_code=response.status_code,
                category="missing_data_envelope",
                response_body_present=True,
            )

        return envelope["data"]

    async def close(self) -> None:
        await self._client.aclose()


def _validation_error_fields(response: httpx.Response) -> tuple:
    """Return the field names from an error envelope's ``errors`` map, never the messages."""
    try:
        envelope = response.json()
    except Exception:
        return ()
    if not isinstance(envelope, dict):
        return ()
    errors = envelope.get("errors")
    if not isinstance(errors, dict):
        return ()
    return tuple(sorted(str(key) for key in errors.keys()))
