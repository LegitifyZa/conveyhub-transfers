import re
from dataclasses import dataclass
from typing import Literal
from uuid import UUID

import httpx

from clients.entities import SUPPORTED_ENTITY_TYPES, EntitiesClient, EntityServiceError


LogicalEntityType = Literal["person", "company", "trust"]
SubmissionPayload = dict[str, str | bool]
_SUBMISSION_ERROR_FIELDS = frozenset({
    "tenant_id", "id_number", "passport_number", "passport_country", "first_name", "surname",
    "email", "cellphone", "legal_name", "is_company", "is_trust", "is_south_african",
    "lookup_profile_slug", "high_court", "masters_office", "body", "general",
})
_MASTERS_OFFICE_NOISE = (
    "master of the high court", "masters office", "master office", "high court", "office",
)


def _required_text(value: object, field: str, max_length: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    if max_length is not None and len(value) > max_length:
        raise ValueError(f"{field} must be at most {max_length} characters")
    return value.strip()


def _base_payload(tenant_id: UUID | str, identifier: str, *, is_company: bool, is_trust: bool) -> SubmissionPayload:
    if not isinstance(tenant_id, (UUID, str)):
        raise ValueError("tenant_id must be a UUID")
    try:
        tenant = tenant_id if isinstance(tenant_id, UUID) else UUID(tenant_id)
    except ValueError:
        raise ValueError("tenant_id must be a UUID") from None
    return {
        "tenant_id": str(tenant), "id_number": _required_text(identifier, "id_number", 50),
        "is_company": is_company, "is_trust": is_trust,
    }


def _optional_fields(**values: str | None) -> SubmissionPayload:
    result: SubmissionPayload = {}
    for field, value in values.items():
        if value is not None:
            if not isinstance(value, str):
                raise ValueError(f"{field} must be a string")
            result[field] = value
    return result


def _normalise_trust_number(value: str) -> str:
    value = re.sub(r"\s+", "", value.strip().upper())
    value = re.sub(r"^IT", "", value)
    value = re.sub(r"\([A-Z]{1,3}\)", "", value)
    match = re.match(r"^(\d+/\d{4})[A-Z]{0,2}$", value)
    return match.group(1) if match else value


def _normalise_masters_office(value: object) -> str:
    office = _required_text(value, "masters_office").lower().replace("_", " ")
    for noise in _MASTERS_OFFICE_NOISE:
        office = office.replace(noise, " ")
    return _required_text("_".join(office.split()), "masters_office")


@dataclass(frozen=True, kw_only=True, repr=False)
class PersonSubmission:
    tenant_id: UUID | str
    id_number: str
    first_name: str | None = None
    surname: str | None = None
    email: str | None = None
    cellphone: str | None = None
    is_south_african: bool = False
    lookup_profile_slug: str | None = None

    def to_payload(self) -> SubmissionPayload:
        payload = _base_payload(self.tenant_id, self.id_number, is_company=False, is_trust=False)
        if not isinstance(self.is_south_african, bool):
            raise ValueError("is_south_african must be a boolean")
        payload["is_south_african"] = self.is_south_african
        return payload | _optional_fields(
            first_name=self.first_name, surname=self.surname, email=self.email,
            cellphone=self.cellphone, lookup_profile_slug=self.lookup_profile_slug,
        )


@dataclass(frozen=True, kw_only=True, repr=False)
class CompanySubmission:
    tenant_id: UUID | str
    registration_no: str
    legal_name: str | None = None

    def to_payload(self) -> SubmissionPayload:
        return _base_payload(self.tenant_id, self.registration_no, is_company=True, is_trust=False) | _optional_fields(legal_name=self.legal_name)


@dataclass(frozen=True, kw_only=True, repr=False)
class TrustSubmission:
    tenant_id: UUID | str
    registration_no: str
    masters_office: str
    legal_name: str | None = None

    def to_payload(self) -> SubmissionPayload:
        payload = _base_payload(self.tenant_id, self.registration_no, is_company=True, is_trust=True)
        number = _normalise_trust_number(_required_text(self.registration_no, "id_number", 50))
        if not number or (number.isdigit() and len(number) == 13):
            raise ValueError("id_number must identify a trust, not a person")
        payload.update(id_number=number, masters_office=_normalise_masters_office(self.masters_office))
        return payload | _optional_fields(legal_name=self.legal_name)


@dataclass(frozen=True, kw_only=True)
class SubmissionReference:
    golden_record_id: UUID
    entity_type: LogicalEntityType


def _invalid_response(operation: str, status_code: int) -> EntityServiceError:
    return EntityServiceError(
        f"Entity service {operation} returned an invalid submission reference",
        operation=operation, status_code=status_code, category="invalid_response", response_body_present=True,
    )


def parse_submission_response(
    response: httpx.Response,
    expected_entity_type: LogicalEntityType,
    *,
    expected_masters_office: str | None = None,
) -> SubmissionReference:
    if not isinstance(expected_entity_type, str) or expected_entity_type not in SUPPORTED_ENTITY_TYPES:
        raise ValueError("expected_entity_type must be person, company or trust")
    office = None
    if expected_entity_type == "trust":
        office = _normalise_masters_office(expected_masters_office)
    elif expected_masters_office is not None:
        raise ValueError("expected_masters_office is only supported for trusts")

    operation = f"submit_{expected_entity_type}"
    if response.is_success and response.status_code != 201:
        raise _invalid_response(operation, response.status_code)
    data = EntitiesClient._extract_data(response, operation=operation, allowed_error_fields=_SUBMISSION_ERROR_FIELDS)
    if not isinstance(data, dict) or not isinstance(data.get("id"), str):
        raise _invalid_response(operation, response.status_code)
    try:
        golden_record_id = UUID(data["id"])
    except ValueError:
        raise _invalid_response(operation, response.status_code) from None

    canonical_type = "company" if expected_entity_type == "trust" else expected_entity_type
    if data.get("entity_type", "person") != canonical_type:
        raise _invalid_response(operation, response.status_code)
    if expected_entity_type != "person" or "is_trust" in data:
        if data.get("is_trust") is not (expected_entity_type == "trust"):
            raise _invalid_response(operation, response.status_code)
    if expected_entity_type == "trust":
        try:
            returned_office = _normalise_masters_office(data.get("masters_office"))
        except ValueError:
            raise _invalid_response(operation, response.status_code) from None
        if returned_office != office:
            raise _invalid_response(operation, response.status_code)

    return SubmissionReference(golden_record_id=golden_record_id, entity_type=expected_entity_type)
