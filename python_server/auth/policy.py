import uuid
from dataclasses import dataclass
from typing import Optional

from .current_user import CurrentUser


class AuthorizationDecision:
    """Policy outcomes for tenant-scoped resource access.

    These are decisions, not HTTP status codes. The caller (route or dependency)
    is responsible for translating them into the appropriate response once the
    policy primitives are wired.
    """

    ALLOWED = "allowed"
    NOT_FOUND = "not_found"
    FORBIDDEN = "forbidden"
    CLIENT_PARTY_CHECK_REQUIRED = "client_party_check_required"


CROSS_TENANT_ROLES = (1, 6)


def is_cross_tenant(user: CurrentUser) -> bool:
    """Return True for roles documented in the handover as cross-tenant.

    Handover §4.3 and §5.5: user_roles_id ∈ (1, 6) (Super Admin, Admin Agent)
    are cross-tenant by design.
    """
    return user.user_roles_id in CROSS_TENANT_ROLES


def resolve_effective_tenant_id(
    user: CurrentUser,
    requested_ai: Optional[int] = None,
) -> int:
    """Return the accountable_institution_id a SQL query should scope to.

    - Cross-tenant users may explicitly select another AI.
    - Normal staff are always locked to their own AI.
    - A mismatch for a non-cross-tenant user is a tenant boundary violation.
    """
    if is_cross_tenant(user):
        if requested_ai is not None:
            return requested_ai
        return user.accountable_institution_id

    if requested_ai is not None and requested_ai != user.accountable_institution_id:
        raise TenantBoundaryError("Tenant scope mismatch")

    return user.accountable_institution_id


def authorize_record_access(
    user: CurrentUser,
    record_accountable_institution_id: int,
) -> str:
    """Decide whether a user may access a record with the given tenant ID.

    Mutations and read-by-ID on foreign-tenant resources should NOT reveal
    existence (eventual 404), so a tenant mismatch returns NOT_FOUND.

    Clients (role 4) require a party check. Until that check is implemented,
    fail closed: CLIENT_PARTY_CHECK_REQUIRED.
    """
    if is_cross_tenant(user):
        return AuthorizationDecision.ALLOWED

    if user.is_client:
        # Handover §5.5: client may only see matters where their
        # golden_record_id is a party. Without that proof, fail closed.
        if user.golden_record_id is None:
            return AuthorizationDecision.NOT_FOUND
        return AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED

    if user.accountable_institution_id == record_accountable_institution_id:
        return AuthorizationDecision.ALLOWED

    return AuthorizationDecision.NOT_FOUND


def authorize_mutation(
    user: CurrentUser,
    record_accountable_institution_id: int,
) -> str:
    """Decide whether a user may mutate a record with the given tenant ID.

    Same semantics as authorize_record_access, but exposed as a separate helper
    so routes can map it to 404 for foreign-tenant mutations specifically.
    """
    return authorize_record_access(user, record_accountable_institution_id)


class TenantBoundaryError(Exception):
    """Raised when a non-cross-tenant user attempts to select a different AI."""
