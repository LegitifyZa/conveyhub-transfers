from typing import Any, Optional

UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

VALID_STATUSES = ["draft", "in_progress", "completed", "cancelled"]


def is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def is_uuid(value: Any) -> bool:
    import re
    if not isinstance(value, str):
        return False
    return re.match(UUID_RE, value, re.IGNORECASE) is not None


def is_valid_status(status: Any) -> bool:
    return isinstance(status, str) and status in VALID_STATUSES


def to_number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        num = float(value)
        return num if str(num) not in ("nan", "inf", "-inf") and num == num else None
    except (TypeError, ValueError):
        return None


def is_sa_postal_code(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 4 and value.isdigit()


def to_date_string(value: Any) -> Optional[str]:
    from dateutil import parser as date_parser
    if not is_non_empty_string(value):
        return None
    try:
        date_parser.parse(value)
        return value
    except (ValueError, TypeError):
        return None
