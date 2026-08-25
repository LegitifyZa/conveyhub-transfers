from typing import Any, Optional

import httpx

from config import Settings


class EntityServiceError(Exception):
    """Raised when the Entities service returns an error or an unexpected shape.

    The exception message is intentionally sanitised: it contains only the
    operation name, the HTTP status, and a generic failure category. The raw
    remote response body is never retained; only a boolean flag indicating that
    a body was present is kept, plus `operation`, `status_code`, and `category`.
    """

    def __init__(
        self,
        message: str,
        *,
        operation: Optional[str] = None,
        status_code: Optional[int] = None,
        category: Optional[str] = None,
        response_body_present: bool = False,
    ) -> None:
        super().__init__(message)
        self.operation = operation
        self.status_code = status_code
        self.category = category
        self.response_body_present = response_body_present


class EntitiesClient:
    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.entities_service_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={"X-Service-Key": settings.secret_key},
        )

    async def get_entity(self, entity_id: str, entity_type: str) -> Any:
        if entity_type not in {"person", "company"}:
            raise ValueError("entity_type must be either 'person' or 'company'")

        response = await self._client.get(
            f"/api/v1/entities/{entity_id}",
            params={"entity_type": entity_type},
            timeout=httpx.Timeout(None, read=10.0),
        )
        return self._extract_data(response, operation="get_entity")

    async def search_entities(self, payload: dict) -> Any:
        response = await self._client.post(
            "/api/v1/entities/search",
            json=payload,
            timeout=httpx.Timeout(None, read=10.0),
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

        response = await self._client.post(
            "/api/v1/entities/submit",
            json=body,
            timeout=httpx.Timeout(None, read=30.0),
        )
        return self._extract_data(response, operation="submit_person")

    def _extract_data(self, response: httpx.Response, *, operation: str) -> Any:
        if not response.is_success:
            raise EntityServiceError(
                f"Entity service {operation} failed with status {response.status_code}",
                operation=operation,
                status_code=response.status_code,
                category="http_error",
                response_body_present=True,
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
