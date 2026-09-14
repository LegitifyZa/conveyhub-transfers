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

async function httpPost(path: string, headers: Record<string, string>, json?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

before(async () => {
  captured = []
  upstreamResponse = { status: 201, body: { message: 'Created', data: { id: TRANSFER_ID } } }

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

describe('v1 matter create + party attach BFF proxies', async () => {
  beforeEach(() => {
    captured = []
    upstreamResponse = { status: 201, body: { message: 'Created', data: { id: TRANSFER_ID } } }
  })

  it('returns 401 for matter creation without a JWT and never calls upstream', async () => {
    const res = await httpPost('/api/v1/transfers/', {}, { property_address: 'A', purchase_price: 1 })
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('returns 401 for party attach without a JWT and never calls upstream', async () => {
    const res = await httpPost(`/api/v1/transfers/${TRANSFER_ID}/parties`, {}, { party_source: 'manual' })
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('returns 401 for a malformed JWT', async () => {
    const res = await httpPost('/api/v1/transfers/', { Authorization: 'Bearer not-a-jwt' }, {})
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('forwards the caller JWT and matter payload unchanged', async () => {
    const token = makeToken()
    const body = { property_address: '12 Test Street', purchase_price: 1500000, client_request_id: REQUEST_ID }
    const res = await httpPost('/api/v1/transfers/', { Authorization: `Bearer ${token}` }, body)
    assert.equal(res.status, 201)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'POST')
    assert.equal(captured[0].url, '/api/v1/transfers/')
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
    assert.deepEqual(JSON.parse(captured[0].body), body)
  })

  it('forwards the party attach body and path to FastAPI', async () => {
    const token = makeToken()
    const body = {
      client_request_id: REQUEST_ID,
      party_source: 'manual',
      entity_type: 'person',
      role: 'transferor',
      manual: { name: 'Jane Example', id_number: '9001010001081', id_type: 'sa_id' },
    }
    const res = await httpPost(`/api/v1/transfers/${TRANSFER_ID}/parties`, { Authorization: `Bearer ${token}` }, body)
    assert.equal(res.status, 201)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/parties`)
    assert.deepEqual(JSON.parse(captured[0].body), body)
  })

  it('returns 404 for a non-UUID transfer id without calling upstream', async () => {
    const res = await httpPost(
      '/api/v1/transfers/not-a-uuid/parties',
      { Authorization: `Bearer ${makeToken()}` },
      { party_source: 'manual' }
    )
    assert.equal(res.status, 404)
    assert.equal(captured.length, 0)
  })

  it('relays FastAPI idempotency conflicts (409) without rewriting them', async () => {
    upstreamResponse = { status: 409, body: { success: false, error: 'client_request_id was already used with a different payload' } }
    const res = await httpPost(
      '/api/v1/transfers/',
      { Authorization: `Bearer ${makeToken()}` },
      { property_address: 'A', purchase_price: 1, client_request_id: REQUEST_ID }
    )
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'client_request_id was already used with a different payload')
  })

  it('relays FastAPI authorization failures (403) unchanged', async () => {
    upstreamResponse = { status: 403, body: { detail: 'Forbidden' } }
    const res = await httpPost(
      `/api/v1/transfers/${TRANSFER_ID}/parties`,
      { Authorization: `Bearer ${makeToken()}` },
      { party_source: 'manual', entity_type: 'person', role: 'transferor', manual: { name: 'Jane' } }
    )
    assert.equal(res.status, 403)
  })

  it('denies client-role matter creation even with transfers:write, without calling upstream', async () => {
    const token = makeToken(['api', 'transfers:read', 'transfers:write'], 4, 5)
    const res = await httpPost(
      '/api/v1/transfers/',
      { Authorization: `Bearer ${token}` },
      { property_address: 'A', purchase_price: 1, client_request_id: REQUEST_ID }
    )
    assert.equal(res.status, 403)
    assert.equal(captured.length, 0)
  })

  it('denies client-role party attach even with transfers:write, without calling upstream', async () => {
    const token = makeToken(['api', 'transfers:read', 'transfers:write'], 4, 5)
    const res = await httpPost(
      `/api/v1/transfers/${TRANSFER_ID}/parties`,
      { Authorization: `Bearer ${token}` },
      { party_source: 'manual', entity_type: 'person', role: 'transferor', manual: { name: 'Jane' } }
    )
    assert.equal(res.status, 403)
    assert.equal(captured.length, 0)
  })
})
