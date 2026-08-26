import hmac


class ServiceKeyError(Exception):
    """Raised when a service key is missing or invalid."""


def verify_service_key(header: str, secret: str) -> None:
    """Constant-time compare the X-Service-Key header against the configured secret."""
    if not secret:
        raise ServiceKeyError("Service key not configured")
    if not header:
        raise ServiceKeyError("Service key required")
    if not hmac.compare_digest(header, secret):
        raise ServiceKeyError("Invalid service key")
