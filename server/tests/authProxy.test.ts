import assert from 'node:assert/strict'
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'

import jwt from 'jsonwebtoken'

// Prevent the Express app from binding to a fixed port during import.
process.env.VERCEL = '1'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-bytes-long!!'

const JWT_SECRET = process.env.JWT_SECRET

const { default: app } = await import('../index')
const { pool } = await import('../db')

interface CapturedRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

let server: Server
let baseUrl: string
let upstream: Server
let captured: CapturedRequest[]
// Per-request upstream responder; tests replace it to steer the stub.
let respond: (req: CapturedRequest) => { status: number; body: unknown }

function makeAccessToken(role = 3, ai = 2, abilities: string[] = ['api', 'transfers:read']) {
  return jwt.sign(
    {
      type: 'access',
      user_id: 42,
      golden_record_id: randomUUID(),
      abilities,
      accountable_institution_id: ai,
      user_roles_id: role,
      tenant_id: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    JWT_SECRET,
    { algorithm: 'HS256' }
  )
}

const loginResponse = {
  message: 'Login successful',
  data: {
    user: { id: 42, user_roles_id: 3, accountable_institution_id: 2 },
    client: { first_name: 'Jane', surname: 'Example' },
    popia_consent: true,
    answered_onboarding_questions: false,
    token: '',
    expires: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'r'.repeat(64),
    refresh_expires: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  },
}

const SID_A = '11111111-1111-4111-8111-111111111111'
const SID_B = '22222222-2222-4222-8222-222222222222'
const REFRESH_TOKEN_A = 'a'.repeat(64)

// The sid-bound cookie pair as the BFF sets it: HttpOnly refresh credential
// plus the JS-readable sid the client echoes back via X-Deedly-Session.
// A real browser POST always sends Fetch Metadata, so cookie-bearing
// requests carry Sec-Fetch-Site: same-origin as their origin evidence.
function authHeaders(sid = SID_A, token = REFRESH_TOKEN_A) {
  return {
    Cookie: `deedly_refresh=${sid}.${token}; deedly_sid=${sid}`,
    'X-Deedly-Session': sid,
    'Sec-Fetch-Site': 'same-origin',
  }
}

function listen(target: Server): Promise<string> {
  return new Promise((resolve) => {
    target.listen(0, '127.0.0.1', () => {
      const address = target.address()
      if (address && typeof address === 'object') {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })
}

async function post(path: string, json: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: 'manual',
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* non-JSON */ }
  return { status: res.status, body, cookies: res.headers.getSetCookie() }
}

before(async () => {
  captured = []
  respond = () => ({ status: 200, body: { message: 'OK', data: {} } })

  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const request: CapturedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      captured.push(request)
      const response = respond(request)
      res
        .writeHead(response.status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(response.body))
    })
  })
  process.env.LEGITIFY_API_BASE_URL = await listen(upstream)

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        baseUrl = `http://127.0.0.1:${address.port}`
      }
      resolve()
    })
  })
})

after(async () => {
  delete process.env.LEGITIFY_API_BASE_URL
  server.close()
  upstream.close()
  await pool.end()
})

beforeEach(() => {
  captured = []
  respond = () => ({ status: 200, body: { message: 'OK', data: {} } })
})

describe('BFF auth proxy: initiate-login', () => {
  it('rejects requests without exactly one identifier and never calls upstream', async () => {
    for (const body of [
      { password: 'x' },
      { id_number: '8001010001081', passport_number: 'A1234567', password: 'x' },
      { id_number: '8001010001081' },
      { passport_number: 'A1234567' },
      { id_number: 'not-13-digits', password: 'x' },
      { id_number: '8001010001081', password: 'x', user_id: 'abc' },
    ]) {
      const { status } = await post('/api/auth/initiate-login', body)
      assert.equal(status, 400)
    }
    assert.equal(captured.length, 0)
  })

  it('forwards id_number + password and relays the resolved user', async () => {
    respond = () => ({ status: 200, body: { message: 'Login successful', data: { user_id: 42, requires_otp: true, message: 'Credentials valid. Please enter OTP.' } } })
    const { status, body } = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'secret' })
    assert.equal(status, 200)
    assert.equal(body.data.user_id, 42)
    assert.equal(body.data.requires_otp, true)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, '/api/v1/auth/initiate-login')
    assert.deepEqual(JSON.parse(captured[0].body), { id_number: '8001010001081', password: 'secret' })
    assert.equal(captured[0].headers.authorization, undefined)
    assert.equal(captured[0].headers['x-service-key'], undefined)
  })

  it('supports passport_number and the user_id disambiguation field', async () => {
    respond = () => ({ status: 200, body: { message: 'Login successful', data: { user_id: 7, requires_otp: true, message: 'ok' } } })
    const { status } = await post('/api/auth/initiate-login', { passport_number: 'A1234567', password: 'secret', user_id: 7 })
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(captured[0].body), { passport_number: 'A1234567', password: 'secret', user_id: 7 })
  })

  it('relays the multi-account picker response unchanged', async () => {
    const accounts = [
      { user_id: 42, accountable_institution_id: 2, accountable_institution_name: 'Firm A', role_id: 3, role_name: 'User' },
      { user_id: 43, accountable_institution_id: 3, accountable_institution_name: 'Firm B', role_id: 2, role_name: 'Manager' },
    ]
    respond = () => ({ status: 200, body: { message: 'Multiple accounts found', data: { user_id: null, requires_otp: false, accounts } } })
    const { status, body } = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'secret' })
    assert.equal(status, 200)
    assert.deepEqual(body.data.accounts, accounts)
  })

  it('relays a 401 invalid-credentials response', async () => {
    respond = () => ({ status: 401, body: { message: 'Invalid credentials', data: [] } })
    const { status, body } = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'wrong' })
    assert.equal(status, 401)
    assert.equal(body.message, 'Invalid credentials')
  })

  it('returns 503 without upstream details when the auth service is unreachable or unconfigured', async () => {
    const saved = process.env.LEGITIFY_API_BASE_URL
    delete process.env.LEGITIFY_API_BASE_URL
    const unconfigured = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'x' })
    process.env.LEGITIFY_API_BASE_URL = saved
    assert.equal(unconfigured.status, 503)
    assert.equal(unconfigured.body.success, false)
    assert.doesNotMatch(JSON.stringify(unconfigured.body), /legitify|127\.0\.0\.1|privateUpstreamData/i)

    respond = () => ({ status: 500, body: { privateUpstreamData: true } })
    const upstreamError = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'x' })
    assert.equal(upstreamError.status, 503)
    assert.doesNotMatch(JSON.stringify(upstreamError.body), /privateUpstreamData/)
  })
})

describe('BFF auth proxy: otp', () => {
  it('rejects invalid user_id and delivery_method without calling upstream', async () => {
    for (const body of [
      {},
      { user_id: 'x' },
      { user_id: -1 },
      { user_id: 42, delivery_method: 'PIGEON' },
    ]) {
      const { status } = await post('/api/auth/otp', body)
      assert.equal(status, 400)
    }
    assert.equal(captured.length, 0)
  })

  it('forwards user_id + delivery_method and relays confirmation_pin', async () => {
    respond = () => ({ status: 200, body: { message: 'OTP sent successfully', data: { confirmation_pin: '12345' } } })
    const { status, body } = await post('/api/auth/otp', { user_id: 42, delivery_method: 'EMAIL' })
    assert.equal(status, 200)
    assert.equal(body.data.confirmation_pin, '12345')
    assert.deepEqual(JSON.parse(captured[0].body), { user_id: 42, delivery_method: 'EMAIL' })
  })

  it('never exposes upstream dev_otp through DEEDLY', async () => {
    respond = () => ({ status: 200, body: { message: 'OTP sent successfully', data: { confirmation_pin: '12345', dev_otp: 654321 } } })
    const { status, body } = await post('/api/auth/otp', { user_id: 42 })
    assert.equal(status, 200)
    assert.equal(body.data.confirmation_pin, '12345')
    assert.equal(body.data.dev_otp, undefined)
    assert.doesNotMatch(JSON.stringify(body), /654321|dev_otp/)
  })
})

describe('BFF auth proxy: login', () => {
  it('rejects malformed user_id/otp without calling upstream', async () => {
    for (const body of [
      {},
      { user_id: 42 },
      { user_id: 42, otp: '123456' },
      { user_id: 42, otp: 12345 },
      { user_id: 42, otp: 1234567 },
    ]) {
      const { status } = await post('/api/auth/login', body)
      assert.equal(status, 400)
    }
    assert.equal(captured.length, 0)
  })

  it('moves the refresh token into an HttpOnly cookie and strips it from the body', async () => {
    const token = makeAccessToken()
    respond = () => ({ status: 200, body: { ...loginResponse, data: { ...loginResponse.data, token, dev_otp: 999999 } } })
    const { status, body, cookies } = await post('/api/auth/login', { user_id: 42, otp: 123456 })
    assert.equal(status, 200)
    assert.equal(body.data.token, token)
    assert.equal(typeof body.data.expires, 'number')
    assert.equal(body.data.user.id, 42)
    assert.deepEqual(body.data.refresh_token, undefined)
    assert.deepEqual(body.data.refresh_expires, undefined)
    assert.deepEqual(body.data.dev_otp, undefined)
    assert.doesNotMatch(JSON.stringify(body), /r{64}|dev_otp|999999/)
    // The cookie carries <sid>.<refresh_token>; the body exposes only the sid.
    const refreshCookie = cookies.find((c) => c.startsWith('deedly_refresh='))
    assert.ok(refreshCookie, 'refresh cookie must be set')
    assert.match(refreshCookie, /HttpOnly/)
    assert.match(refreshCookie, /Secure/)
    assert.match(refreshCookie, /SameSite=Strict/)
    assert.match(refreshCookie, /Path=\/api\/auth/)
    assert.match(refreshCookie, /Max-Age=2592000/)
    const cookieValue = decodeURIComponent(refreshCookie.split(';')[0].split('=').slice(1).join('='))
    const sid = cookieValue.slice(0, cookieValue.indexOf('.'))
    const embeddedToken = cookieValue.slice(cookieValue.indexOf('.') + 1)
    assert.equal(embeddedToken, 'r'.repeat(64))
    assert.equal(body.data.sid, sid)
    assert.match(sid, /^[0-9a-f-]{36}$/)
    const sidCookie = cookies.find((c) => c.startsWith('deedly_sid='))
    assert.ok(sidCookie, 'readable sid cookie must be set')
    assert.doesNotMatch(sidCookie, /HttpOnly/)
    // The readable marker is scoped Path=/ so every SPA route can read it for
    // post-reload restore; the HttpOnly refresh credential stays at
    // Path=/api/auth.
    assert.match(sidCookie, /Path=\//)
    assert.doesNotMatch(sidCookie, /Path=\/api\/auth/)
    assert.equal(decodeURIComponent(sidCookie.split(';')[0].split('=')[1]), sid)
    assert.deepEqual(JSON.parse(captured[0].body), { user_id: 42, otp: 123456 })
  })

  it('fails closed when the issued token fails local verification, and sets no cookie', async () => {
    const retiredRoleToken = makeAccessToken(5)
    respond = () => ({ status: 200, body: { ...loginResponse, data: { ...loginResponse.data, token: retiredRoleToken } } })
    const { status, body, cookies } = await post('/api/auth/login', { user_id: 42, otp: 123456 })
    assert.equal(status, 401)
    assert.equal(body.success, false)
    assert.equal(cookies.length, 0)

    const foreignToken = jwt.sign({ type: 'access' }, 'a-different-secret')
    respond = () => ({ status: 200, body: { ...loginResponse, data: { ...loginResponse.data, token: foreignToken } } })
    const foreign = await post('/api/auth/login', { user_id: 42, otp: 123456 })
    assert.equal(foreign.status, 401)
    assert.equal(foreign.cookies.length, 0)
  })

  it('returns 503 when the upstream login body violates the token contract', async () => {
    respond = () => ({ status: 200, body: { message: 'Login successful', data: { token: makeAccessToken(), expires: 123 } } })
    const { status, cookies } = await post('/api/auth/login', { user_id: 42, otp: 123456 })
    assert.equal(status, 503)
    assert.equal(cookies.length, 0)
  })

  it('relays a 401 invalid-OTP response and sets no cookie', async () => {
    respond = () => ({ status: 401, body: { message: 'Invalid OTP', data: [] } })
    const { status, cookies } = await post('/api/auth/login', { user_id: 42, otp: 654321 })
    assert.equal(status, 401)
    assert.equal(cookies.length, 0)
  })
})

describe('BFF auth proxy: refresh', () => {
  it('returns 401 without a refresh cookie and never calls upstream', async () => {
    const { status } = await post('/api/auth/refresh', {})
    assert.equal(status, 401)
    assert.equal(captured.length, 0)
  })

  it('refuses a refresh cookie without the matching X-Deedly-Session sid', async () => {
    const sameSite = { 'Sec-Fetch-Site': 'same-origin' }
    // No header at all.
    const missing = await post('/api/auth/refresh', {}, { Cookie: `deedly_refresh=${SID_A}.${REFRESH_TOKEN_A}`, ...sameSite })
    assert.equal(missing.status, 401)
    // Mismatched sid: the cookie belongs to a different login.
    const mismatched = await post('/api/auth/refresh', {}, {
      Cookie: `deedly_refresh=${SID_A}.${REFRESH_TOKEN_A}; deedly_sid=${SID_A}`,
      'X-Deedly-Session': SID_B,
      ...sameSite,
    })
    assert.equal(mismatched.status, 401)
    // A bare (pre-sid) cookie value is not a usable credential either.
    const legacy = await post('/api/auth/refresh', {}, { Cookie: `deedly_refresh=${REFRESH_TOKEN_A}`, 'X-Deedly-Session': SID_A, ...sameSite })
    assert.equal(legacy.status, 401)
    assert.equal(captured.length, 0)
    // Refresh never writes cookies — a late response cannot set/clear one.
    assert.equal(missing.cookies.length, 0)
    assert.equal(mismatched.cookies.length, 0)
    assert.equal(legacy.cookies.length, 0)
  })

  it('exchanges the cookie refresh token upstream and relays the new access token', async () => {
    const token = makeAccessToken()
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token, expires: 999999 } } })
    const { status, body, cookies } = await post('/api/auth/refresh', {}, authHeaders())
    assert.equal(status, 200)
    assert.equal(body.data.token, token)
    assert.deepEqual(JSON.parse(captured[0].body), { refresh_token: REFRESH_TOKEN_A })
    assert.equal(captured[0].url, '/api/v1/auth/refresh')
    assert.equal(cookies.length, 0)
  })

  it('never emits Set-Cookie — even when upstream rejects the refresh token', async () => {
    respond = () => ({ status: 401, body: { message: 'Invalid refresh token', data: [] } })
    const { status, cookies } = await post('/api/auth/refresh', {}, authHeaders())
    assert.equal(status, 401)
    assert.equal(cookies.length, 0)
  })

  it('applies the same claim checks as login before returning a refreshed token', async () => {
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: makeAccessToken(5), expires: 999999 } } })
    const retired = await post('/api/auth/refresh', {}, authHeaders())
    assert.equal(retired.status, 401)
    assert.equal(retired.body.success, false)
    assert.equal(retired.cookies.length, 0)
    assert.doesNotMatch(JSON.stringify(retired.body), /token/)

    const foreign = jwt.sign({ type: 'access' }, 'a-different-secret')
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: foreign, expires: 999999 } } })
    const wrongSignature = await post('/api/auth/refresh', {}, authHeaders())
    assert.equal(wrongSignature.status, 401)
    assert.equal(wrongSignature.cookies.length, 0)
  })

  it('returns 503 without a cookie change when the refresh body violates the token contract', async () => {
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: 123 } } })
    const { status, body, cookies } = await post('/api/auth/refresh', {}, authHeaders())
    assert.equal(status, 503)
    assert.equal(body.success, false)
    assert.equal(cookies.length, 0)
  })
})

describe('BFF auth proxy: logout', () => {
  it('clears the cookie pair only when the presented sid matches the cookie', async () => {
    // Matching sid → both cookies cleared.
    const own = await post('/api/auth/logout', {}, authHeaders())
    assert.equal(own.status, 200)
    assert.equal(own.body.success, true)
    assert.match(own.cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
    assert.match(own.cookies.find((c) => c.startsWith('deedly_sid=')) ?? '', /Max-Age=0/)

    // A logout for session A must not clear session B's cookie.
    const other = await post('/api/auth/logout', {}, {
      Cookie: `deedly_refresh=${SID_B}.tokenB; deedly_sid=${SID_B}`,
      'X-Deedly-Session': SID_A,
      'Sec-Fetch-Site': 'same-origin',
    })
    assert.equal(other.status, 200)
    assert.equal(other.cookies.length, 0)

    // No cookie → nothing to clear; still succeeds.
    const none = await post('/api/auth/logout', {}, { 'X-Deedly-Session': SID_A })
    assert.equal(none.status, 200)
    assert.equal(none.cookies.length, 0)

    // Cookie present but no sid proof → not cleared.
    const unproven = await post('/api/auth/logout', {}, { Cookie: `deedly_refresh=${SID_B}.tokenB`, 'Sec-Fetch-Site': 'same-origin' })
    assert.equal(unproven.status, 200)
    assert.equal(unproven.cookies.length, 0)
    assert.equal(captured.length, 0)
  })

  it('forwards the Bearer token to upstream logout fire-and-forget', async () => {
    const token = makeAccessToken()
    const { status } = await post('/api/auth/logout', {}, { Authorization: `Bearer ${token}` })
    assert.equal(status, 200)
    // Upstream forwarding is fire-and-forget: the response is not delayed by
    // it, so poll briefly for the captured request.
    for (let i = 0; i < 50 && captured.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, '/api/v1/auth/logout')
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
  })

  it('still succeeds and clears a matching cookie when upstream logout fails', async () => {
    respond = () => ({ status: 500, body: {} })
    const { status, cookies } = await post('/api/auth/logout', {}, {
      ...authHeaders(),
      Authorization: `Bearer ${makeAccessToken()}`,
    })
    assert.equal(status, 200)
    assert.match(cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
    // Drain the fire-and-forget upstream call so it cannot leak into the next
    // test's capture assertions.
    for (let i = 0; i < 50 && captured.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(captured.length, 1)
  })
})

describe('BFF auth proxy: origin/CSRF guard', () => {
  it('rejects a cross-site Origin before any upstream activity', async () => {
    const { status, body } = await post('/api/auth/initiate-login', { id_number: '8001010001081', password: 'x' }, { Origin: 'https://evil.example' })
    assert.equal(status, 403)
    assert.equal(body.success, false)
    assert.equal(captured.length, 0)
  })

  it('rejects Sec-Fetch-Site: cross-site even without an Origin', async () => {
    const { status } = await post('/api/auth/refresh', {}, { 'Sec-Fetch-Site': 'cross-site' })
    assert.equal(status, 403)
    assert.equal(captured.length, 0)
  })

  it('applies the guard to every auth mutation including login and logout', async () => {
    for (const path of ['/api/auth/initiate-login', '/api/auth/otp', '/api/auth/login', '/api/auth/refresh', '/api/auth/logout']) {
      const { status } = await post(path, {}, { Origin: 'https://evil.example' })
      assert.equal(status, 403, path)
    }
    assert.equal(captured.length, 0)
  })

  it('accepts the same-origin Host match and the loopback dev origin', async () => {
    const sameOrigin = await post('/api/auth/refresh', {}, { Origin: baseUrl })
    assert.equal(sameOrigin.status, 401) // passes the guard; fails on missing cookie
    const devOrigin = await post('/api/auth/refresh', {}, { Origin: 'http://localhost:5173' })
    assert.equal(devOrigin.status, 401)
  })

  it('honours AUTH_ALLOWED_ORIGINS when configured and rejects others', async () => {
    const saved = process.env.AUTH_ALLOWED_ORIGINS
    process.env.AUTH_ALLOWED_ORIGINS = 'https://app.example.test'
    try {
      const allowed = await post('/api/auth/refresh', {}, { Origin: 'https://app.example.test' })
      assert.equal(allowed.status, 401)
      const denied = await post('/api/auth/refresh', {}, { Origin: 'http://localhost:5173' })
      assert.equal(denied.status, 403)
      const hostMatch = await post('/api/auth/refresh', {}, { Origin: baseUrl })
      assert.equal(hostMatch.status, 403)
      // An explicitly allowlisted same-site origin is also accepted.
      const sameSite = await post('/api/auth/refresh', {}, { Origin: 'https://app.example.test', 'Sec-Fetch-Site': 'same-site' })
      assert.equal(sameSite.status, 401)
    } finally {
      if (saved === undefined) delete process.env.AUTH_ALLOWED_ORIGINS
      else process.env.AUTH_ALLOWED_ORIGINS = saved
    }
  })

  it('rejects a cookie-bearing request with no Origin and no fetch metadata', async () => {
    // Absence of Origin does not prove absence of ambient authority: a
    // cookie-carrying request with no origin evidence at all is an ambiguous
    // browser request and is refused before any upstream activity.
    const { status } = await post('/api/auth/refresh', {}, {
      Cookie: `deedly_refresh=${SID_A}.${REFRESH_TOKEN_A}; deedly_sid=${SID_A}`,
      'X-Deedly-Session': SID_A,
    })
    assert.equal(status, 403)
    assert.equal(captured.length, 0)
  })

  it('accepts a credential-free request with no origin evidence and a same-origin metadata request', async () => {
    // No Origin, no fetch metadata, no cookies — a non-browser probe with no
    // ambient authority to protect. It passes the guard (then fails on
    // missing cookie, proving the guard did not reject it).
    const probe = await post('/api/auth/refresh', {})
    assert.equal(probe.status, 401)
    // No Origin but Sec-Fetch-Site attests same-origin → trusted.
    const sameOrigin = await post('/api/auth/refresh', {}, {
      Cookie: `deedly_refresh=${SID_A}.${REFRESH_TOKEN_A}`,
      'Sec-Fetch-Site': 'same-origin',
    })
    assert.equal(sameOrigin.status, 401) // guard passed; refused on sid proof
    assert.equal(captured.length, 0)
  })

  it('rejects same-site metadata without an Origin to allowlist', async () => {
    const { status } = await post('/api/auth/refresh', {}, {
      Cookie: `deedly_refresh=${SID_A}.${REFRESH_TOKEN_A}`,
      'X-Deedly-Session': SID_A,
      'Sec-Fetch-Site': 'same-site',
    })
    assert.equal(status, 403)
    assert.equal(captured.length, 0)
  })
})
