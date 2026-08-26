import jwt, { JwtPayload } from 'jsonwebtoken'
import { CurrentUser } from './currentUser'

export class JWTVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JWTVerificationError'
  }
}

export interface TokenClaims extends JwtPayload {
  user_id: number
  golden_record_id?: string | null
  abilities?: string[]
  accountable_institution_id: number
  user_roles_id: number
  tenant_id?: string | null
  type?: string
}

export function verifyJwt(token: string, jwtSecret: string | undefined): CurrentUser {
  if (!jwtSecret) {
    throw new JWTVerificationError('JWT verification not configured')
  }

  let payload: TokenClaims
  try {
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as TokenClaims
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new JWTVerificationError('JWT has expired')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new JWTVerificationError('Invalid JWT')
    }
    throw new JWTVerificationError('Invalid JWT')
  }

  if (typeof payload.exp !== 'number') {
    throw new JWTVerificationError('JWT missing expiration')
  }

  if (payload.type !== 'access') {
    throw new JWTVerificationError('Invalid JWT type')
  }

  return buildCurrentUser(payload)
}

function buildCurrentUser(payload: TokenClaims): CurrentUser {
  const required: (keyof TokenClaims)[] = [
    'user_id',
    'accountable_institution_id',
    'user_roles_id',
    'abilities',
  ]
  const missing = required.filter((key) => payload[key] === undefined)
  if (missing.length > 0) {
    throw new JWTVerificationError(`JWT missing required claims: ${missing.join(', ')}`)
  }

  return new CurrentUser({
    user_id: toInt(payload.user_id, 'user_id'),
    golden_record_id: toUuidOrNull(payload.golden_record_id, 'golden_record_id'),
    abilities: toStringArray(payload.abilities, 'abilities'),
    accountable_institution_id: toInt(payload.accountable_institution_id, 'accountable_institution_id'),
    user_roles_id: toInt(payload.user_roles_id, 'user_roles_id'),
    tenant_id: toUuidOrNull(payload.tenant_id, 'tenant_id'),
  })
}

function toInt(value: unknown, name: string): number {
  if (typeof value === 'boolean') {
    throw new JWTVerificationError(`Invalid ${name} claim type`)
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number(value)
  }
  throw new JWTVerificationError(`Invalid ${name} claim type`)
}

function toStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new JWTVerificationError(`Invalid ${name} claim type`)
  }
  return value.map((item) => String(item))
}

function toUuidOrNull(value: unknown, name: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const str = String(value)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(str)) {
    throw new JWTVerificationError(`Invalid ${name} claim type`)
  }
  return str
}
