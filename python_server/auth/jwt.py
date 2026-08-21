import uuid
from typing import List, Optional

import jwt

from .current_user import CurrentUser


class JWTVerificationError(Exception):
    """Raised when a JWT cannot be verified or its claims are malformed."""


def verify_jwt(token: str, jwt_secret: Optional[str]) -> CurrentUser:
    """Verify an HS256 access token and return a CurrentUser.

    Validates required claims and their types without logging the token.
    """
    if not jwt_secret:
        raise JWTVerificationError("JWT verification not configured")

    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            options={"require": ["exp"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise JWTVerificationError("JWT has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise JWTVerificationError("Invalid JWT") from exc

    if not isinstance(payload, dict):
        raise JWTVerificationError("Invalid JWT payload")

    if payload.get("type") != "access":
        raise JWTVerificationError("Invalid JWT type")

    return _build_current_user(payload)


def _build_current_user(payload: dict) -> CurrentUser:
    required_claims = [
        "user_id",
        "accountable_institution_id",
        "user_roles_id",
        "abilities",
    ]
    missing = [c for c in required_claims if c not in payload]
    if missing:
        raise JWTVerificationError(
            f"JWT missing required claims: {', '.join(missing)}"
        )

    return CurrentUser(
        user_id=_to_int(payload["user_id"], "user_id"),
        golden_record_id=_to_uuid_or_none(
            payload.get("golden_record_id"), "golden_record_id"
        ),
        abilities=_to_abilities(payload["abilities"]),
        accountable_institution_id=_to_int(
            payload["accountable_institution_id"], "accountable_institution_id"
        ),
        user_roles_id=_to_int(payload["user_roles_id"], "user_roles_id"),
        tenant_id=_to_uuid_or_none(payload.get("tenant_id"), "tenant_id"),
    )


def _to_int(value, name: str) -> int:
    if isinstance(value, bool):
        raise JWTVerificationError(f"Invalid {name} claim type")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise JWTVerificationError(f"Invalid {name} claim type")


def _to_abilities(value) -> List[str]:
    if not isinstance(value, list):
        raise JWTVerificationError("Invalid abilities claim type")
    return [str(a) for a in value]


def _to_uuid_or_none(value, name: str) -> Optional[uuid.UUID]:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise JWTVerificationError(f"Invalid {name} claim type")
