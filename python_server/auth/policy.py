import uuid
from dataclasses import dataclass
from typing import Optional

from .current_user import CurrentUser, is_positive_integer


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


def _resolve_own_tenant_id(
    user: CurrentUser,
    requested_ai: Optional[int] = None,
) -> int:
    """Resolve the caller's verified institution, rejecting any other.

    Approved policy: same-institution isolation applies to every caller —
    there is no privileged-role exception. Institution scoping is independent
    of user_roles_id.
    """
    if not is_positive_integer(user.accountable_institution_id) or (
        requested_ai is not None and not is_positive_integer(requested_ai)
    ):
        raise TenantBoundaryError("Invalid institution context")

    if requested_ai is not None and requested_ai != user.accountable_institution_id:
        raise TenantBoundaryError("Tenant scope mismatch")

    return user.accountable_institution_id


def resolve_effective_tenant_id(
    user: CurrentUser,
    requested_ai: Optional[int] = None,
) -> int:
    """Return the accountable_institution_id a read query should scope to.

    All callers are locked to their verified institution.
    """
    return _resolve_own_tenant_id(user, requested_ai)


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
    if not is_positive_integer(user.accountable_institution_id) or not is_positive_integer(record_accountable_institution_id):
        return AuthorizationDecision.NOT_FOUND

    if user.is_client:
        # Handover §5.5: client may only see matters where their
        # golden_record_id is a party. Without that proof, fail closed.
        if user.accountable_institution_id != record_accountable_institution_id or user.golden_record_id is None:
            return AuthorizationDecision.NOT_FOUND
        return AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED

    if user.accountable_institution_id == record_accountable_institution_id:
        return AuthorizationDecision.ALLOWED

    return AuthorizationDecision.NOT_FOUND


def resolve_write_tenant_id(
    user: CurrentUser,
    requested_ai: Optional[int] = None,
) -> int:
    """Return the accountable_institution_id a mutation should be attributed to.

    Approved policy: mutations always use the verified caller's institution —
    a requested AI that differs is a tenant boundary violation for every role.
    """
    return _resolve_own_tenant_id(user, requested_ai)


def authorize_mutation(
    user: CurrentUser,
    record_accountable_institution_id: int,
) -> str:
    """Decide whether a user may mutate a record with the given tenant ID.

    Approved policy: no caller may mutate another accountable institution's
    records — institution scoping is independent of user_roles_id. A mismatch
    returns NOT_FOUND so foreign-tenant mutations do not reveal existence.
    """
    if not is_positive_integer(user.accountable_institution_id) or not is_positive_integer(record_accountable_institution_id):
        return AuthorizationDecision.NOT_FOUND

    if user.is_client:
        if user.accountable_institution_id != record_accountable_institution_id or user.golden_record_id is None:
            return AuthorizationDecision.NOT_FOUND
        return AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED

    if user.accountable_institution_id == record_accountable_institution_id:
        return AuthorizationDecision.ALLOWED

    return AuthorizationDecision.NOT_FOUND


class TenantBoundaryError(Exception):
    """Raised when a caller attempts to select an institution other than their verified own."""
