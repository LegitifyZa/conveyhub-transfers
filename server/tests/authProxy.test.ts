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
    const cookie = cookies.find((c) => c.startsWith('deedly_refresh='))
    assert.ok(cookie, 'refresh cookie must be set')
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Path=\/api\/auth/)
    assert.match(cookie, /Max-Age=2592000/)
    assert.equal(decodeURIComponent(cookie.split(';')[0].split('=')[1]), 'r'.repeat(64))
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

  it('exchanges the cookie refresh token upstream and relays the new access token', async () => {
    const token = makeAccessToken()
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token, expires: 999999 } } })
    const { status, body } = await post('/api/auth/refresh', {}, { Cookie: 'deedly_refresh=abc123refresh; other=1' })
    assert.equal(status, 200)
    assert.equal(body.data.token, token)
    assert.deepEqual(JSON.parse(captured[0].body), { refresh_token: 'abc123refresh' })
    assert.equal(captured[0].url, '/api/v1/auth/refresh')
  })

  it('clears the cookie when upstream rejects the refresh token', async () => {
    respond = () => ({ status: 401, body: { message: 'Invalid refresh token', data: [] } })
    const { status, cookies } = await post('/api/auth/refresh', {}, { Cookie: 'deedly_refresh=expired' })
    assert.equal(status, 401)
    const cleared = cookies.find((c) => c.startsWith('deedly_refresh='))
    assert.ok(cleared)
    assert.match(cleared, /Max-Age=0/)
  })

  it('applies the same claim checks as login before returning a refreshed token', async () => {
    // Retired-role token: a session must not be formed, so the refresh cookie
    // is cleared — retrying would only mint the same unusable token.
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: makeAccessToken(5), expires: 999999 } } })
    const retired = await post('/api/auth/refresh', {}, { Cookie: 'deedly_refresh=abc123refresh' })
    assert.equal(retired.status, 401)
    assert.equal(retired.body.success, false)
    assert.match(retired.cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
    assert.doesNotMatch(JSON.stringify(retired.body), /token/)

    const foreign = jwt.sign({ type: 'access' }, 'a-different-secret')
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: foreign, expires: 999999 } } })
    const wrongSignature = await post('/api/auth/refresh', {}, { Cookie: 'deedly_refresh=abc123refresh' })
    assert.equal(wrongSignature.status, 401)
    assert.match(wrongSignature.cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
  })

  it('returns 503 without a cookie change when the refresh body violates the token contract', async () => {
    respond = () => ({ status: 200, body: { message: 'Token refreshed', data: { token: 123 } } })
    const { status, body, cookies } = await post('/api/auth/refresh', {}, { Cookie: 'deedly_refresh=abc123refresh' })
    assert.equal(status, 503)
    assert.equal(body.success, false)
    assert.equal(cookies.length, 0)
  })
})

describe('BFF auth proxy: logout', () => {
  it('always clears the cookie and succeeds even with no Bearer token', async () => {
    const { status, body, cookies } = await post('/api/auth/logout', {})
    assert.equal(status, 200)
    assert.equal(body.success, true)
    assert.match(cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
    assert.equal(captured.length, 0)
  })

  it('forwards the Bearer token to upstream logout', async () => {
    const token = makeAccessToken()
    const { status } = await post('/api/auth/logout', {}, { Authorization: `Bearer ${token}` })
    assert.equal(status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, '/api/v1/auth/logout')
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
  })

  it('still clears the session locally when upstream logout fails', async () => {
    respond = () => ({ status: 500, body: {} })
    const { status, cookies } = await post('/api/auth/logout', {}, { Authorization: `Bearer ${makeAccessToken()}` })
    assert.equal(status, 200)
    assert.match(cookies.find((c) => c.startsWith('deedly_refresh=')) ?? '', /Max-Age=0/)
  })
})
