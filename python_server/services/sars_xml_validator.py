"""Validate a SARS TDC01 XML payload against a local XSD schema.

The schema path is taken from the ``SARS_TDC01_XSD_PATH`` environment variable.
If no XSD is configured, validation returns a non-fatal result explaining that
no local schema is available. This keeps the boundary in place without guessing
the V1.17 contract.
"""

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


class SarsXmlValidatorError(Exception):
    """Raised when validation cannot complete."""

    pass


@dataclass
class ValidationResult:
    valid: bool
    schema_loaded: bool
    schema_path: Optional[str]
    errors: List[str]


def _load_xsd_path() -> Optional[str]:
    return os.getenv("SARS_TDC01_XSD_PATH")


def validate(xml_string: str, *, schema_path: Optional[str] = None) -> ValidationResult:
    """Validate ``xml_string`` against the configured XSD.

    Returns a ``ValidationResult`` with ``valid=False`` and an explanatory
    error when the XSD is missing or ``lxml`` is not installed.
    """
    path = schema_path or _load_xsd_path()
    if not path:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=None,
            errors=["SARS_TDC01_XSD_PATH is not configured; cannot validate against V1.17"],
        )

    if not os.path.exists(path):
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=path,
            errors=[f"Configured XSD file not found: {path}"],
        )

    try:
        from lxml import etree
    except ImportError:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=path,
            errors=["lxml is not installed; XSD validation is unavailable"],
        )

    try:
        schema_root = etree.parse(path)
        schema = etree.XMLSchema(schema_root)
    except Exception as exc:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=path,
            errors=[f"Failed to load XSD schema: {exc}"],
        )

    try:
        xml_doc = etree.fromstring(xml_string.encode("utf-8"))
        schema.assertValid(xml_doc)
        return ValidationResult(valid=True, schema_loaded=True, schema_path=path, errors=[])
    except etree.DocumentInvalid as exc:
        errors = [str(err) for err in exc.error_log]
        return ValidationResult(valid=False, schema_loaded=True, schema_path=path, errors=errors)
    except Exception as exc:
        return ValidationResult(
            valid=False,
            schema_loaded=True,
            schema_path=path,
            errors=[f"XML parse/validation error: {exc}"],
        )


def validate_payload(payload: Dict[str, Any], *, schema_path: Optional[str] = None) -> ValidationResult:
    """Convenience helper: serialize ``payload`` and validate the result."""
    from services.sars_xml_serializer import serialize

    try:
        xml_string = serialize(payload)
    except Exception as exc:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=schema_path or _load_xsd_path(),
            errors=[f"Payload serialization failed: {exc}"],
        )
    return validate(xml_string, schema_path=schema_path)
