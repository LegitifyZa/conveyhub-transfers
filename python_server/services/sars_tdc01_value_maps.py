"""Central mapping and validation for SARS TDC01 V1.17 values.

Mapping functions are deliberately conservative: when the upstream contract is
not authoritative, the function returns None or raises SarsValueMapError so the
caller can turn the gap into a readiness blocker rather than guessing.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional


class SarsValueMapError(Exception):
    """Raised when a value cannot be mapped to a SARS-legal value."""

    def __init__(self, value: Any, target: str, reason: str) -> None:
        self.value = value
        self.target = target
        self.reason = reason
        super().__init__(f"Cannot map {value!r} to {target}: {reason}")


class SarsUnresolvedMappingError(SarsValueMapError):
    """Raised when a mapping is explicitly unresolved (not a validation failure)."""

    def __init__(self, value: Any, target: str) -> None:
        super().__init__(value, target, "mapping not yet authoritative")


# SARS simple type enumerations -------------------------------------------------

YES_NO_TRUE = "Y"
YES_NO_FALSE = "N"

GENDER = {"M": "M", "F": "F", "male": "M", "female": "F"}

MARITAL_STATUS = {
    "single": "N",
    "not_married": "N",
    "in_community": "I",
    "out_of_community": "O",
    "divorced": "D",
    "widowed": "D",
    "N": "N",
    "I": "I",
    "O": "O",
    "D": "D",
}

TRANSFER_DUTY_TYPE = {
    "UNIDIVIDED_PROPERTY_TRANSFER",
    "SHARES_MEMBERS_TRANSFER",
    "SERVITUDES",
}

VAT_RATE_IND = {"S", "Z"}

# NatureOfPerson mapping: person is unambiguous; juristic/trust require the
# exact Golden Record classification and are therefore unresolved by default.
NATURE_OF_PERSON = {
    "person": "INDIVIDUAL",
    # juristic/trust sub-types are intentionally not defaulted
    "company": None,
    "trust": None,
}

ID_NO_PATTERN = re.compile(r"^\d{13}$")
TAX_REF_PATTERN = re.compile(r"^\w{8}$|^\w{10}$")
PASSPORT_PATTERN = re.compile(r"^\w{0,16}$")
COUNTRY_PATTERN = re.compile(r"^\w{0,3}$")
TD_REFERENCE_PATTERN = re.compile(r"^\w{8}$|^\w{10}$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def yes_no(value: Optional[Any]) -> Optional[str]:
    """Return SARS Y/N or None if the value is absent/unknown."""
    if value is None:
        return None
    if value is True:
        return YES_NO_TRUE
    if value is False:
        return YES_NO_FALSE
    return None


def gender(value: Optional[Any]) -> Optional[str]:
    """Map a DEEDLY gender value to SARS M/F."""
    if value is None:
        return None
    mapped = GENDER.get(str(value).strip().lower())
    if mapped is not None:
        return mapped
    raise SarsValueMapError(value, "GenderType", "must be 'M' or 'F'")


def marital_status(value: Optional[Any]) -> Optional[str]:
    """Map a DEEDLY marital status to SARS N/I/O/D."""
    if value is None:
        return None
    mapped = MARITAL_STATUS.get(str(value).strip().lower())
    if mapped is not None:
        return mapped
    raise SarsValueMapError(value, "MaritalStatusType", "must be N, I, O or D")


def map_nature_of_person(entity_type: str, golden_record: Optional[dict] = None) -> str:
    """Return the SARS EntityTypeType for a DEEDLY party.

    Person maps unambiguously to INDIVIDUAL. Company and trust require the
    authoritative Golden Record sub-classification; if not available, an
    SarsUnresolvedMappingError is raised so the builder can report a blocker.
    """
    canonical = (entity_type or "").strip().lower()
    if canonical == "person":
        return NATURE_OF_PERSON["person"]
    if canonical == "company":
        raise SarsUnresolvedMappingError("company", "NatureOfPerson")
    if canonical == "trust":
        raise SarsUnresolvedMappingError("trust", "NatureOfPerson")
    raise SarsValueMapError(entity_type, "NatureOfPerson", "unrecognised entity_type")


def normalize_id_number(value: Optional[str]) -> Optional[str]:
    """Return a 13-digit South African ID number, or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if ID_NO_PATTERN.match(cleaned):
        return cleaned
    return None


def normalize_passport(value: Optional[str]) -> Optional[str]:
    """Return a SARS PassportNo value, or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if PASSPORT_PATTERN.match(cleaned):
        return cleaned
    return None


def normalize_tax_ref(value: Optional[str]) -> Optional[str]:
    """Return an 8- or 10-character SARS tax/VAT reference, or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if TAX_REF_PATTERN.match(cleaned):
        return cleaned
    return None


def normalize_country(value: Optional[str]) -> Optional[str]:
    """Return a SARS CountryType (<=3 word chars) or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if COUNTRY_PATTERN.match(cleaned):
        return cleaned
    return None


def normalize_email(value: Optional[str]) -> Optional[str]:
    """Return a valid email, or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if EMAIL_PATTERN.match(cleaned):
        return cleaned
    return None


def normalize_telephone(value: Optional[str]) -> Optional[str]:
    """Return a SARS TelFaxNo (digits only, up to 15) or None."""
    if not value:
        return None
    cleaned = re.sub(r"\D", "", str(value))
    if 0 < len(cleaned) <= 15:
        return cleaned
    return None


def normalize_td_reference(value: Optional[str]) -> Optional[str]:
    """Return a SARS TDReferenceNo (8 or 10 word chars) or None."""
    if not value:
        return None
    cleaned = str(value).strip()
    if TD_REFERENCE_PATTERN.match(cleaned):
        return cleaned
    return None


def validate_transfer_duty_type(value: Optional[str]) -> Optional[str]:
    """Validate a TransferDutyType enum value."""
    if value is None:
        return None
    cleaned = str(value).strip()
    if cleaned in TRANSFER_DUTY_TYPE:
        return cleaned
    raise SarsValueMapError(value, "TransferDutyType", "must be one of " + str(TRANSFER_DUTY_TYPE))


def validate_vat_rate_ind(value: Optional[str]) -> Optional[str]:
    """Validate a VATRateInd enum value."""
    if value is None:
        return None
    cleaned = str(value).strip()
    if cleaned in VAT_RATE_IND:
        return cleaned
    raise SarsValueMapError(value, "VATRateInd", "must be 'S' or 'Z'")


def to_financial(value: Optional[Any]) -> Optional[Decimal]:
    """Convert a value to a 2-decimal SARS financial amount."""
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise SarsValueMapError(value, "FinancialAmtDecimalType", "not a valid decimal")
    if d.is_infinite():
        raise SarsValueMapError(value, "FinancialAmtDecimalType", "infinite value")
    if d == d.to_integral_value():
        d = Decimal(d.quantize(Decimal("0.00"), rounding=ROUND_HALF_UP))
    return d


def to_percentage(value: Optional[Any]) -> Optional[Decimal]:
    """Convert a value to a 2-decimal SARS percentage."""
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise SarsValueMapError(value, "PercentageType", "not a valid decimal")
    if d < Decimal("0") or d > Decimal("100"):
        raise SarsValueMapError(value, "PercentageType", "must be 0-100")
    return d.quantize(Decimal("0.00"), rounding=ROUND_HALF_UP)


def to_date(value: Optional[Any]) -> Optional[date]:
    """Convert an iso date string or datetime to a date."""
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        if len(value) >= 10:
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                pass
    raise SarsValueMapError(value, "date", "not a valid date")


def to_int(value: Optional[Any]) -> Optional[int]:
    """Convert a value to an int, returning None for None."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise SarsValueMapError(value, "int", "not a valid integer")
