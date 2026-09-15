import { Router, Request, Response } from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { verifyJwt } from '../auth/jwt'

// Browser auth proxy for the upstream Legitify auth service. The BFF never
// mints or fabricates tokens: every credential comes from upstream over
// LEGITIFY_API_BASE_URL. The upstream refresh token is kept out of JavaScript
// entirely — the BFF sets it as an HttpOnly SameSite=Strict cookie and reads it
// back only on /api/auth/refresh. The access token is relayed to the browser
// body (held in memory, sent as Bearer); refresh_token/refresh_expires are
// stripped from the login response before it reaches the client.
const router = Router()

const AUTH_UNAVAILABLE = { success: false, error: 'Authentication service unavailable' }
const REFRESH_COOKIE = 'deedly_refresh'
// Upstream default refresh lifetime is 30 days (auth_service refresh_expires).
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function authBaseUrl(): string | null {
  const baseUrl = process.env.LEGITIFY_API_BASE_URL
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

function clearRefreshCookieHeader(): string {
  return `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0`
}

function refreshCookieHeader(refreshToken: string): string {
  return `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${Math.floor(REFRESH_COOKIE_MAX_AGE_MS / 1000)}`
}

function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      const value = decodeURIComponent(part.slice(eq + 1).trim())
      return value || null
    }
  }
  return null
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
// confirmation_pin (anti-phishing) and dev_otp (upstream debug builds only).
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
  // dev_otp (upstream debug builds) is never exposed through DEEDLY.
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

// Step 3: exchange the OTP for tokens. On success the refresh token is moved
// into the HttpOnly cookie and stripped from the browser-visible body.
// The issued access token is verified locally so a session is never
// established for claims the BFF boundary would reject (e.g. retired roles).
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
  const clientData = { ...data }
  delete clientData.refresh_token
  delete clientData.refresh_expires
  delete clientData.dev_otp
  res.setHeader('Set-Cookie', refreshCookieHeader(data.refresh_token as string))
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json({ message: envelope.message, data: clientData })
}))

// Silent session restore. The refresh credential only ever lives in the
// HttpOnly cookie; the browser posts an empty body and receives a fresh
// access token. A failed refresh clears the cookie so no stale credential
// lingers server-side-visible.
router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = readRefreshCookie(req)
  if (!refreshToken) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
  const result = await callUpstream(res, 'refresh', { refresh_token: refreshToken })
  if (!result) return
  if (result.status === 401 || result.status === 403) {
    res.setHeader('Set-Cookie', clearRefreshCookieHeader())
    relay(res, result)
    return
  }
  if (!result.ok) {
    relay(res, result)
    return
  }
  // The returned access token gets the same claim checks as login before it
  // reaches the browser: signature, expiry, type=access, deployed role 1-4 and
  // institution claim. A token this boundary rejects cannot form a session,
  // so the refresh cookie is cleared as well.
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
    res.setHeader('Set-Cookie', clearRefreshCookieHeader())
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
  res.status(result.status).json({
    message: envelope.message,
    data: { token: data.token, expires: data.expires },
  })
}))

// Logout is best-effort upstream (it requires the Bearer `api` ability) but
// unconditional locally: the refresh cookie is always cleared so the browser
// session ends even when the access token is already expired or upstream is
// down. Upstream refresh tokens are stateless (no revocation list).
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  res.setHeader('Set-Cookie', clearRefreshCookieHeader())
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
