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
let upstreamBaseUrl: string
let captured: CapturedRequest[]
let upstreamResponse: { status: number; body: unknown } | null

const TRANSFER_ID = '22222222-2222-4222-8222-222222222222'
const PROPERTY_ID = '55555555-5555-4555-8555-555555555555'
const REQUEST_ID = '66666666-6666-4666-8666-666666666666'

function makeToken(abilities: string[] = ['api', 'transfers:read', 'transfers:write'], role = 3, ai = 5) {
  return jwt.sign(
    {
      type: 'access',
      user_id: 1,
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

async function http(path: string, method: string, headers: Record<string, string>, json?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

before(async () => {
  captured = []
  upstreamResponse = {
    status: 201,
    body: { message: 'Created', data: { id: 'link-1', propertyKind: 'input', property: { id: PROPERTY_ID } } },
  }

  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const response = upstreamResponse ?? { status: 500, body: null }
      res
        .writeHead(response.status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(response.body))
    })
  })
  upstreamBaseUrl = await listen(upstream)
  process.env.DEEDLY_API_BASE_URL = upstreamBaseUrl

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
  delete process.env.DEEDLY_API_BASE_URL
  server.close()
  upstream.close()
  await pool.end()
})

describe('v1 matter–property BFF surface', async () => {
  beforeEach(() => {
    captured = []
    upstreamResponse = {
      status: 201,
      body: { message: 'Created', data: { id: 'link-1', propertyKind: 'input', property: { id: PROPERTY_ID } } },
    }
  })

  // ---- POST /api/v1/transfers/:id/properties (proxied write) ----

  it('returns 401 for property attach without a JWT and never calls upstream', async () => {
    const res = await http(`/api/v1/transfers/${TRANSFER_ID}/properties`, 'POST', {}, { property_id: PROPERTY_ID })
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('denies client-role property attach even with transfers:write, without calling upstream', async () => {
    const token = makeToken(['api', 'transfers:read', 'transfers:write'], 4, 5)
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'POST',
      { Authorization: `Bearer ${token}` },
      { property_id: PROPERTY_ID, client_request_id: REQUEST_ID }
    )
    assert.equal(res.status, 403)
    assert.equal(captured.length, 0)
  })

  it('returns 404 for a non-UUID transfer id without calling upstream', async () => {
    const res = await http(
      '/api/v1/transfers/not-a-uuid/properties',
      'POST',
      { Authorization: `Bearer ${makeToken()}` },
      { property_id: PROPERTY_ID }
    )
    assert.equal(res.status, 404)
    assert.equal(captured.length, 0)
  })

  it('forwards the link body, path and caller JWT unchanged', async () => {
    const token = makeToken()
    const body = { property_id: PROPERTY_ID, client_request_id: REQUEST_ID }
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'POST',
      { Authorization: `Bearer ${token}` },
      body
    )
    assert.equal(res.status, 201)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'POST')
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/properties`)
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
    assert.deepEqual(JSON.parse(captured[0].body), body)
  })

  it('forwards the manual capture body unchanged', async () => {
    const token = makeToken()
    const body = {
      client_request_id: REQUEST_ID,
      property: {
        street_address: '12 Test Street',
        city: 'Johannesburg',
        province: 'Gauteng',
        postal_code: '2196',
        property_type: 'Freehold',
        erf_number: '1234',
        legal_description: 'ERF 1234 SANDTON',
      },
    }
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'POST',
      { Authorization: `Bearer ${token}` },
      body
    )
    assert.equal(res.status, 201)
    assert.deepEqual(JSON.parse(captured[0].body), body)
  })

  it('relays FastAPI idempotency conflicts (409) unchanged', async () => {
    upstreamResponse = { status: 409, body: { success: false, error: 'client_request_id was already used with a different payload' } }
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'POST',
      { Authorization: `Bearer ${makeToken()}` },
      { property_id: PROPERTY_ID, client_request_id: REQUEST_ID }
    )
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'client_request_id was already used with a different payload')
  })

  it('maps an unreachable FastAPI to a generic 503', async () => {
    upstreamResponse = { status: 502, body: { error: 'upstream exploded' } }
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'POST',
      { Authorization: `Bearer ${makeToken()}` },
      { property_id: PROPERTY_ID }
    )
    assert.equal(res.status, 503)
    assert.equal(res.body.error, 'Matter service temporarily unavailable')
  })

  // ---- GET /api/v1/transfers/:id/properties (local readback gate) ----
  // The happy path needs a database; the auth/ability gates run first, so
  // these assertions never reach the pool.

  it('returns 401 for property readback without a JWT', async () => {
    const res = await http(`/api/v1/transfers/${TRANSFER_ID}/properties`, 'GET', {})
    assert.equal(res.status, 401)
  })

  it('fails closed for client-role property readback', async () => {
    const token = makeToken(['api', 'transfers:read'], 4, 5)
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'GET',
      { Authorization: `Bearer ${token}` }
    )
    assert.equal(res.status, 404)
  })

  it('returns 403 for property readback without transfers:read', async () => {
    const token = makeToken(['api', 'transfers:write'], 3, 5)
    const res = await http(
      `/api/v1/transfers/${TRANSFER_ID}/properties`,
      'GET',
      { Authorization: `Bearer ${token}` }
    )
    assert.equal(res.status, 403)
  })

  // ---- GET /api/v1/properties (local discovery gate) ----

  it('returns 401 for discovery without a JWT', async () => {
    const res = await http('/api/v1/properties', 'GET', {})
    assert.equal(res.status, 401)
  })

  it('fails closed for client-role discovery', async () => {
    const token = makeToken(['api', 'transfers:read'], 4, 5)
    const res = await http('/api/v1/properties', 'GET', { Authorization: `Bearer ${token}` })
    assert.equal(res.status, 404)
  })

  it('returns 403 for discovery without transfers:read', async () => {
    const token = makeToken(['api', 'transfers:write'], 3, 5)
    const res = await http('/api/v1/properties', 'GET', { Authorization: `Bearer ${token}` })
    assert.equal(res.status, 403)
  })
})
