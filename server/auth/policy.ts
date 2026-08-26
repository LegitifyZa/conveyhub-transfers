import { CurrentUser } from './currentUser'

export const AuthorizationDecision = {
  ALLOWED: 'allowed',
  NOT_FOUND: 'not_found',
  FORBIDDEN: 'forbidden',
  CLIENT_PARTY_CHECK_REQUIRED: 'client_party_check_required',
} as const

export type AuthorizationDecision = (typeof AuthorizationDecision)[keyof typeof AuthorizationDecision]

export const CROSS_TENANT_ROLES = [1, 6]

export class TenantBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantBoundaryError'
  }
}

/**
 * Return true for roles documented in the handover as cross-tenant.
 * Handover §4.3 and §5.5: user_roles_id ∈ (1, 6) (Super Admin, Admin Agent)
 * are cross-tenant by design.
 */
export function isCrossTenant(user: CurrentUser): boolean {
  return CROSS_TENANT_ROLES.includes(user.user_roles_id)
}

/**
 * Return the accountable_institution_id a SQL query should scope to.
 * Cross-tenant users may explicitly select another AI; normal staff are locked.
 */
export function resolveEffectiveTenantId(
  user: CurrentUser,
  requestedAi?: number
): number {
  if (isCrossTenant(user)) {
    return requestedAi ?? user.accountable_institution_id
  }

  if (requestedAi !== undefined && requestedAi !== user.accountable_institution_id) {
    throw new TenantBoundaryError('Tenant scope mismatch')
  }

  return user.accountable_institution_id
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
  if (isCrossTenant(user)) {
    return AuthorizationDecision.ALLOWED
  }

  if (user.isClient) {
    // Handover §5.5: client may only see matters where their golden_record_id
    // is a party. Without that proof, fail closed.
    if (user.golden_record_id === null || user.golden_record_id === undefined) {
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
 * Decide whether a user may mutate a record with the given tenant ID.
 * Same semantics as authorizeRecordAccess, exposed as a separate helper.
 */
export function authorizeMutation(
  user: CurrentUser,
  recordAccountableInstitutionId: number
): AuthorizationDecision {
  return authorizeRecordAccess(user, recordAccountableInstitutionId)
}
