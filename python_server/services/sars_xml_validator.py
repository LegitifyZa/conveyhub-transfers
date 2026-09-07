"""Validate a SARS TDC01 XML payload against the V1.17 XSD.

The schema path is taken from the ``SARS_TDC01_XSD_PATH`` environment variable
first, then falls back to the bundled V1.17 schema package. If the configured
or bundled schema is unavailable or invalid, validation returns a controlled
``ValidationResult`` with ``schema_loaded=False`` and an explanatory error.
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


def _default_xsd_path() -> str:
    this_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(
        this_dir, "..", "resources", "sars", "SARSTransferDutyReturnV1.17.xsd"
    )


def _load_xsd_path() -> Optional[str]:
    """Resolve the configured or bundled schema path."""
    env_path = os.getenv("SARS_TDC01_XSD_PATH")
    if env_path:
        return env_path
    bundled = _default_xsd_path()
    return bundled if os.path.exists(bundled) else None


def _maybe_import_xmlschema():
    try:
        import xmlschema

        return xmlschema
    except ImportError as exc:
        raise SarsXmlValidatorError(
            "xmlschema is not installed; XSD validation is unavailable"
        ) from exc


def validate(xml_string: str, *, schema_path: Optional[str] = None) -> ValidationResult:
    """Validate ``xml_string`` against the configured V1.17 XSD.

    Returns a controlled ``ValidationResult`` for missing schemas, invalid
    schemas, malformed XML, and schema violations. Raw library exceptions are
    never leaked; they are captured as error strings in the result.
    """
    path = schema_path or _load_xsd_path()
    if not path:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=path,
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
        xmlschema = _maybe_import_xmlschema()
        schema = xmlschema.XMLSchema(path)
    except Exception as exc:
        return ValidationResult(
            valid=False,
            schema_loaded=False,
            schema_path=path,
            errors=[f"Failed to load XSD schema: {exc}"],
        )

    try:
        # xmlschema.is_valid returns True/False but does not enumerate errors.
        # iter_errors yields XMLSchemaValidationError objects for each violation.
        if schema.is_valid(xml_string):
            return ValidationResult(valid=True, schema_loaded=True, schema_path=path, errors=[])

        errors = [str(err) for err in schema.iter_errors(xml_string)]
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
