import { CurrentUser, isPositiveInteger } from './currentUser'

export const AuthorizationDecision = {
  ALLOWED: 'allowed',
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  CLIENT_PARTY_CHECK_REQUIRED: 'client_party_check_required',
} as const

export type AuthorizationDecision = (typeof AuthorizationDecision)[keyof typeof AuthorizationDecision]

export class TenantBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantBoundaryError'
  }
}

/**
 * Resolve the caller's verified institution, rejecting any other.
 * Approved policy: same-institution isolation applies to every caller —
 * there is no privileged-role exception. Institution scoping is independent
 * of user_roles_id.
 */
function resolveOwnTenantId(user: CurrentUser, requestedAi?: number): number {
  if (!isPositiveInteger(user.accountable_institution_id)
    || (requestedAi !== undefined && !isPositiveInteger(requestedAi))) {
    throw new TenantBoundaryError('Invalid institution context')
  }

  if (requestedAi !== undefined && requestedAi !== user.accountable_institution_id) {
    throw new TenantBoundaryError('Tenant scope mismatch')
  }

  return user.accountable_institution_id
}

/**
 * Return the accountable_institution_id a read query should scope to.
 * All callers are locked to their verified institution.
 */
export function resolveEffectiveTenantId(
  user: CurrentUser,
  requestedAi?: number
): number {
  return resolveOwnTenantId(user, requestedAi)
}

/**
 * Decide whether a user may access a record with the given tenant ID.
 * Foreign-tenant mismatches return NOT_FOUND so existence is not revealed.
 * Clients (role 4) require a Golden Record party check; until implemented, fail closed.
 */
export function authorizeRecordAccess(
  user: CurrentUser,
  recordAccountableInstitutionId: number
): AuthorizationDecision {
  if (!isPositiveInteger(user.accountable_institution_id) || !isPositiveInteger(recordAccountableInstitutionId)) {
    return AuthorizationDecision.NOT_FOUND
  }

  if (user.isClient) {
    // Handover §5.5: client may only see matters where their golden_record_id
    // is a party. Without that proof, fail closed.
    if (user.accountable_institution_id !== recordAccountableInstitutionId
      || user.golden_record_id === null || user.golden_record_id === undefined) {
      return AuthorizationDecision.NOT_FOUND
    }
    return AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED
  }

  if (user.accountable_institution_id === recordAccountableInstitutionId) {
    return AuthorizationDecision.ALLOWED
  }

  return AuthorizationDecision.NOT_FOUND
}

/**
 * Return the accountable_institution_id a mutation should be attributed to.
 * Approved policy: mutations always use the verified caller's institution —
 * no role holds a cross-tenant exception. A requested AI that differs from
 * the caller's verified AI is a tenant boundary violation.
 */
export function resolveWriteTenantId(
  user: CurrentUser,
  requestedAi?: number
): number {
  return resolveOwnTenantId(user, requestedAi)
}

/**
 * Decide whether a user may mutate a record with the given tenant ID.
 * Approved policy: no caller may mutate another accountable institution's
 * records — institution scoping is independent of user_roles_id.
 * Foreign-tenant mismatches return NOT_FOUND so existence is not revealed.
 */
export function authorizeMutation(
  user: CurrentUser,
  recordAccountableInstitutionId: number
): AuthorizationDecision {
  if (!isPositiveInteger(user.accountable_institution_id) || !isPositiveInteger(recordAccountableInstitutionId)) {
    return AuthorizationDecision.NOT_FOUND
  }

  if (user.isClient) {
    if (user.accountable_institution_id !== recordAccountableInstitutionId
      || user.golden_record_id === null || user.golden_record_id === undefined) {
      return AuthorizationDecision.NOT_FOUND
    }
    return AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED
  }

  if (user.accountable_institution_id === recordAccountableInstitutionId) {
    return AuthorizationDecision.ALLOWED
  }

  return AuthorizationDecision.NOT_FOUND
}
