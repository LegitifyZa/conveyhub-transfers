import { randomUUID } from 'node:crypto'
import { Router, Request, Response, NextFunction } from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { verifyJwt } from '../auth/jwt'

// Browser auth proxy for the upstream Legitify auth service. The BFF never
// mints or fabricates tokens: every credential comes from upstream over
// LEGITIFY_API_BASE_URL.
//
// Credential storage and race coordination:
// - The upstream refresh token never reaches JavaScript. On login the BFF
//   generates a per-login session id (sid) and sets TWO cookies:
//   `deedly_refresh=<sid>.<refresh_token>` (HttpOnly) and `deedly_sid=<sid>`
//   (JS-readable). Both are Secure, SameSite=Strict, Path=/api/auth.
// - /refresh requires the caller to echo the sid back in X-Deedly-Session
//   (double-submit): the refresh credential is unusable to anyone who did not
//   complete that login, and a stale Set-Cookie left over from a superseded
//   login cannot be exercised. /refresh never emits Set-Cookie, so a late
//   refresh response can never overwrite or clear a newer login's cookie.
// - /logout clears the cookie pair only when the presented X-Deedly-Session
//   matches the cookie's embedded sid — a logout for session A arriving while
//   session B's cookie is set does not touch it.
// - The client additionally serializes login/refresh/logout through one
//   promise queue (src/lib/api/session.ts), so overlapping auth operations
//   cannot interleave their requests in the first place.
//
// The access token is relayed to the browser body (held in memory, sent as
// Bearer); refresh_token/refresh_expires/dev_otp are stripped from responses
// before they reach the client.
const router = Router()

const AUTH_UNAVAILABLE = { success: false, error: 'Authentication service unavailable' }
const FORBIDDEN = { success: false, error: 'Forbidden' }
const REFRESH_COOKIE = 'deedly_refresh'
const SID_COOKIE = 'deedly_sid'
const SID_HEADER = 'x-deedly-session'
// Upstream default refresh lifetime is 30 days (auth_service refresh_expires).
const REFRESH_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60

// Explicit origin/CSRF guard for auth mutations — enforced before any upstream
// activity, not delegated to CORS or SameSite alone. Cross-site fetch-metadata
// is rejected outright; a present Origin must appear in AUTH_ALLOWED_ORIGINS
// (comma-separated) when configured, else match the request Host (the
// supported same-origin /api deployment). Loopback origins are accepted only
// outside production so the Vite dev proxy origin works; requests without an
// Origin are non-browser clients and carry no ambient cookie authority.
function trustedAuthOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    res.status(403).json(FORBIDDEN)
    return
  }
  const origin = req.headers.origin
  if (origin === undefined) {
    next()
    return
  }
  const allowed = (process.env.AUTH_ALLOWED_ORIGINS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean)
  if (allowed.length > 0) {
    if (allowed.includes(origin)) {
      next()
      return
    }
    res.status(403).json(FORBIDDEN)
    return
  }
  try {
    const parsed = new URL(origin)
    const host = req.headers.host
    if (host && parsed.host === host) {
      next()
      return
    }
    if (process.env.NODE_ENV !== 'production'
      && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      next()
      return
    }
  } catch {
    // Malformed Origin — reject below.
  }
  res.status(403).json(FORBIDDEN)
}

router.use(trustedAuthOrigin)

function authBaseUrl(): string | null {
  const baseUrl = process.env.LEGITIFY_API_BASE_URL
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

function setAuthCookies(sid: string, refreshToken: string): string[] {
  const base = `Secure; SameSite=Strict; Path=/api/auth; Max-Age=${REFRESH_COOKIE_MAX_AGE_S}`
  return [
    `${REFRESH_COOKIE}=${encodeURIComponent(`${sid}.${refreshToken}`)}; HttpOnly; ${base}`,
    `${SID_COOKIE}=${encodeURIComponent(sid)}; ${base}`,
  ]
}

function clearAuthCookies(): string[] {
  const base = 'Secure; SameSite=Strict; Path=/api/auth; Max-Age=0'
  return [
    `${REFRESH_COOKIE}=; HttpOnly; ${base}`,
    `${SID_COOKIE}=; ${base}`,
  ]
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      const value = decodeURIComponent(part.slice(eq + 1).trim())
      return value || null
    }
  }
  return null
}

function readRefreshCookie(req: Request): { sid: string; token: string } | null {
  const raw = readCookie(req, REFRESH_COOKIE)
  if (!raw) return null
  const dot = raw.indexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  return { sid: raw.slice(0, dot), token: raw.slice(dot + 1) }
}

function presentedSid(req: Request): string | null {
  const value = req.headers[SID_HEADER]
  return typeof value === 'string' && value ? value : null
}

interface UpstreamResult {
  ok: boolean
  status: number
  body: string
  contentType: string | null
}

async function callUpstream(
  res: Response,
  path: string,
  payload: Record<string, unknown>,
  authorization?: string
): Promise<UpstreamResult | null> {
  const baseUrl = authBaseUrl()
  if (!baseUrl) {
    res.status(503).json(AUTH_UNAVAILABLE)
    return null
  }
  try {
    const upstream = await fetch(`${baseUrl}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    const body = await upstream.text()
    if (upstream.status >= 500) {
      res.status(503).json(AUTH_UNAVAILABLE)
      return null
    }
    return { ok: upstream.ok, status: upstream.status, body, contentType: upstream.headers.get('content-type') }
  } catch {
    res.status(503).json(AUTH_UNAVAILABLE)
    return null
  }
}

function relay(res: Response, result: UpstreamResult): void {
  if (result.contentType) res.setHeader('Content-Type', result.contentType)
  res.status(result.status).send(result.body)
}

const ID_NUMBER_PATTERN = /^\d{13}$/
const DELIVERY_METHODS = new Set(['CELL', 'EMAIL', 'BOTH'])

function invalid(res: Response, error: string): void {
  res.status(400).json({ success: false, error })
}

// Step 1: verify identifier + password upstream. Returns either a single
// resolved user (requires_otp) or an account list when the identifier maps to
// multiple accounts (browser re-submits with the chosen user_id).
router.post('/initiate-login', asyncHandler(async (req: Request, res: Response) => {
  const { id_number: idNumber, passport_number: passportNumber, password, user_id: userId } = req.body ?? {}
  const hasId = typeof idNumber === 'string' && idNumber.length > 0
  const hasPassport = typeof passportNumber === 'string' && passportNumber.length > 0
  if (hasId === hasPassport) {
    invalid(res, 'Provide exactly one of id_number or passport_number')
    return
  }
  if (hasId && !ID_NUMBER_PATTERN.test(idNumber)) {
    invalid(res, 'id_number must be a 13-digit SA ID number')
    return
  }
  if (typeof password !== 'string' || !password) {
    invalid(res, 'password is required')
    return
  }
  const payload: Record<string, unknown> = hasId
    ? { id_number: idNumber, password }
    : { passport_number: passportNumber, password }
  if (userId !== undefined) {
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
      invalid(res, 'user_id must be a positive integer')
      return
    }
    payload.user_id = userId
  }
  const result = await callUpstream(res, 'initiate-login', payload)
  if (result) relay(res, result)
}))

// Step 2 (optional): trigger/resend OTP delivery. Passes through the upstream
// confirmation_pin (anti-phishing); dev_otp (upstream debug builds) is never
// exposed through DEEDLY.
router.post('/otp', asyncHandler(async (req: Request, res: Response) => {
  const { user_id: userId, delivery_method: deliveryMethod } = req.body ?? {}
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    invalid(res, 'user_id must be a positive integer')
    return
  }
  const payload: Record<string, unknown> = { user_id: userId }
  if (deliveryMethod !== undefined) {
    if (typeof deliveryMethod !== 'string' || !DELIVERY_METHODS.has(deliveryMethod)) {
      invalid(res, 'delivery_method must be one of CELL, EMAIL, BOTH')
      return
    }
    payload.delivery_method = deliveryMethod
  }
  const result = await callUpstream(res, 'otp', payload)
  if (!result) return
  if (!result.ok) {
    relay(res, result)
    return
  }
  let envelope: { message?: unknown; data?: Record<string, unknown> }
  try {
    envelope = JSON.parse(result.body)
  } catch {
    res.status(503).json(AUTH_UNAVAILABLE)
    return
  }
  const data = typeof envelope?.data === 'object' && envelope.data !== null ? { ...envelope.data } : {}
  delete data.dev_otp
  res.status(result.status).json({ message: envelope?.message, data })
}))

// Step 3: exchange the OTP for tokens. On success the refresh credential is
// moved into the sid-bound HttpOnly cookie pair and stripped from the
// browser-visible body; the sid itself is returned in `data.sid` so the client
// can echo it on refresh/logout. The issued access token is verified locally
// so a session is never established for claims the BFF boundary would reject
// (e.g. retired roles).
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { user_id: userId, otp } = req.body ?? {}
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    invalid(res, 'user_id must be a positive integer')
    return
  }
  if (typeof otp !== 'number' || !Number.isInteger(otp) || otp < 100000 || otp > 999999) {
    invalid(res, 'otp must be a 6-digit number')
    return
  }
  const result = await callUpstream(res, 'login', { user_id: userId, otp })
  if (!result) return
  if (!result.ok) {
    relay(res, result)
    return
  }
  let envelope: { message?: unknown; data?: Record<string, unknown> }
  try {
    envelope = JSON.parse(result.body)
  } catch {
    res.status(503).json(AUTH_UNAVAILABLE)
    return
  }
  const data = envelope?.data
  if (typeof envelope?.message !== 'string' || !data
    || typeof data.token !== 'string' || !data.token
    || typeof data.expires !== 'number' || !Number.isFinite(data.expires)
    || typeof data.refresh_token !== 'string' || data.refresh_token.length < 20) {
    res.status(503).json(AUTH_UNAVAILABLE)
    return
  }
  try {
    verifyJwt(data.token as string, process.env.JWT_SECRET)
  } catch {
    // Issued claims fail this boundary's checks (e.g. retired/unknown role).
    // Fail closed rather than establishing a session that cannot be used.
    res.status(401).json({ success: false, error: 'Authentication failed' })
    return
  }
  const sid = randomUUID()
  const clientData: Record<string, unknown> = { ...data, sid }
  delete clientData.refresh_token
  delete clientData.refresh_expires
  delete clientData.dev_otp
  res.setHeader('Set-Cookie', setAuthCookies(sid, data.refresh_token as string))
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json({ message: envelope.message, data: clientData })
}))

// Silent session restore. The sid acts as a double-submit proof bound to the
// HttpOnly cookie value: without it (cleared memory and cookie after logout,
// or a stale cookie left by a superseded login) the exchange is refused
// before any upstream call. This endpoint never emits Set-Cookie — a late
// refresh response can therefore never create, overwrite or clear a cookie.
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const credential = readRefreshCookie(req)
  const sid = presentedSid(req)
  if (!credential || sid === null || sid !== credential.sid) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
  const result = await callUpstream(res, 'refresh', { refresh_token: credential.token })
  if (!result) return
  if (!result.ok) {
    relay(res, result)
    return
  }
  // The returned access token gets the same claim checks as login before it
  // reaches the browser: signature, expiry, type=access, deployed role 1-4 and
  // institution claim.
  let envelope: { message?: unknown; data?: Record<string, unknown> }
  try {
    envelope = JSON.parse(result.body)
  } catch {
    res.status(503).json(AUTH_UNAVAILABLE)
    return
  }
  const data = envelope?.data
  if (typeof envelope?.message !== 'string' || !data
    || typeof data.token !== 'string' || !data.token
    || typeof data.expires !== 'number' || !Number.isFinite(data.expires)) {
    res.status(503).json(AUTH_UNAVAILABLE)
    return
  }
  try {
    verifyJwt(data.token as string, process.env.JWT_SECRET)
  } catch {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
  res.status(result.status).json({
    message: envelope.message,
    data: { token: data.token, expires: data.expires },
  })
}))

// Logout is best-effort upstream (it requires the Bearer `api` ability) but
// unconditional locally. The cookie pair is cleared only when the presented
// sid matches the cookie's embedded sid — a logout issued for session A can
// never clear session B's cookie. (Local teardown is not upstream token
// revocation: upstream refresh tokens are stateless and expire naturally.)
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  const credential = readRefreshCookie(req)
  if (credential && presentedSid(req) === credential.sid) {
    res.setHeader('Set-Cookie', clearAuthCookies())
  }
  const authorization = req.headers.authorization
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    // Fire-and-forget forwarding; a failed upstream logout must not block
    // local session teardown.
    const baseUrl = authBaseUrl()
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: authorization },
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        })
      } catch {
        // Local teardown already done; upstream expiry will retire the token.
      }
    }
  }
  res.json({ success: true })
}))

export default router
