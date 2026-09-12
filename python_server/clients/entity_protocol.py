from typing import Any, Optional

import httpx


# Search supports person, company and trust. Canonical trust retrieval uses
# company; the logical trust discriminator is validated by the visibility
# service against the returned is_trust field.
SUPPORTED_ENTITY_TYPES = frozenset({"person", "company", "trust"})


class EntityServiceError(Exception):
    """Raised when a Legitify service returns an error or an unexpected shape.

    The exception message is intentionally sanitised: it contains only the
    operation name, the HTTP status, and a generic failure category. The raw
    remote response body is never retained; only a boolean flag indicating that
    a body was present is kept, plus `operation`, `status_code`, `category` and,
    for validation failures, the offending field names (never their values).

    Categories: ``not_found`` (404, tenant-safe "unknown or not linked"),
    ``validation_error`` (422), ``http_error`` (other non-2xx), ``timeout``,
    ``network``, ``malformed_json``, ``missing_data_envelope``, ``invalid_response``.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: Optional[str] = None,
        status_code: Optional[int] = None,
        category: Optional[str] = None,
        response_body_present: bool = False,
        error_fields: tuple[str, ...] = (),
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


def extract_entity_data(
    response: httpx.Response,
    *,
    operation: str,
    allowed_error_fields: Optional[frozenset[str]] = None,
) -> Any:
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
            error_fields=_validation_error_fields(response, allowed_fields=allowed_error_fields),
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


def _validation_error_fields(
    response: httpx.Response, *, allowed_fields: Optional[frozenset[str]] = None,
) -> tuple[str, ...]:
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
    return tuple(sorted(str(key) for key in errors.keys() if allowed_fields is None or key in allowed_fields))
