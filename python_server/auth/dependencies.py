from typing import Optional

from fastapi import Depends, Header, Request

from .current_user import CurrentUser
from .exceptions import FORBIDDEN, UNAUTHORIZED
from .jwt import JWTVerificationError, verify_jwt
from .service_key import ServiceKeyError, verify_service_key


def _parse_bearer(header: str) -> tuple[str, str]:
    parts = header.split(" ", 1)
    if len(parts) != 2:
        return "", ""
    return parts[0].strip(), parts[1].strip()


async def require_jwt_or_service_key(
    request: Request,
    authorization: Optional[str] = Header(None),
    x_service_key: Optional[str] = Header(None),
) -> Optional[CurrentUser]:
    """Return CurrentUser for a valid JWT, None for a valid S2S key, or raise 401."""
    settings = getattr(request.app.state, "settings", None)
    if not settings:
        raise UNAUTHORIZED

    if x_service_key is not None:
        try:
            verify_service_key(x_service_key, settings.secret_key)
            return None
        except ServiceKeyError:
            raise UNAUTHORIZED

    if not authorization:
        raise UNAUTHORIZED

    scheme, token = _parse_bearer(authorization)
    if scheme.lower() != "bearer" or not token:
        raise UNAUTHORIZED

    try:
        return verify_jwt(token, settings.jwt_secret)
    except JWTVerificationError:
        raise UNAUTHORIZED


async def require_jwt(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> CurrentUser:
    """Return CurrentUser for a valid JWT or raise 401."""
    settings = getattr(request.app.state, "settings", None)
    if not settings:
        raise UNAUTHORIZED

    if not authorization:
        raise UNAUTHORIZED

    scheme, token = _parse_bearer(authorization)
    if scheme.lower() != "bearer" or not token:
        raise UNAUTHORIZED

    try:
        return verify_jwt(token, settings.jwt_secret)
    except JWTVerificationError:
        raise UNAUTHORIZED


def require_ability(ability: str):
    """Factory that returns a FastAPI dependency requiring a verified JWT with the ability."""

    async def _check(user: CurrentUser = Depends(require_jwt)) -> CurrentUser:
        if user.has_ability(ability):
            return user
        raise FORBIDDEN

    return _check
