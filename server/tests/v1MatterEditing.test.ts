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

async function httpPatch(path: string, headers: Record<string, string>, json?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

const PATCH_BODY = {
  expected_updated_at: '2026-01-02T10:00:00+00:00',
  expected_matter_updated_at: '2026-01-02T10:00:01+00:00',
  property_address: '99 New Road',
  firm_reference: 'FRM-2',
}

before(async () => {
  captured = []
  upstreamResponse = { status: 200, body: { message: 'OK', data: { id: TRANSFER_ID } } }

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

describe('v1 core matter editing BFF proxy', async () => {
  beforeEach(() => {
    captured = []
    upstreamResponse = { status: 200, body: { message: 'OK', data: { id: TRANSFER_ID } } }
  })

  it('returns 401 without a JWT and never calls upstream', async () => {
    const res = await httpPatch(`/api/v1/transfers/${TRANSFER_ID}`, {}, PATCH_BODY)
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('returns 404 for a non-UUID transfer id without calling upstream', async () => {
    const res = await httpPatch(
      '/api/v1/transfers/not-a-uuid',
      { Authorization: `Bearer ${makeToken()}` },
      PATCH_BODY
    )
    assert.equal(res.status, 404)
    assert.equal(captured.length, 0)
  })

  it('denies client-role writes even with transfers:write, without calling upstream', async () => {
    const res = await httpPatch(
      `/api/v1/transfers/${TRANSFER_ID}`,
      { Authorization: `Bearer ${makeToken(['api', 'transfers:write'], 4, 5)}` },
      PATCH_BODY
    )
    assert.equal(res.status, 403)
    assert.equal(captured.length, 0)
  })

  it('forwards PATCH method, JWT and body unchanged', async () => {
    const token = makeToken()
    const res = await httpPatch(
      `/api/v1/transfers/${TRANSFER_ID}`,
      { Authorization: `Bearer ${token}` },
      PATCH_BODY
    )
    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'PATCH')
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}`)
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
    assert.deepEqual(JSON.parse(captured[0].body), PATCH_BODY)
  })

  it('relays the 409 stale-version conflict without rewriting it', async () => {
    upstreamResponse = { status: 409, body: { success: false, error: 'Matter was modified by another user; reload and retry' } }
    const res = await httpPatch(
      `/api/v1/transfers/${TRANSFER_ID}`,
      { Authorization: `Bearer ${makeToken()}` },
      PATCH_BODY
    )
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'Matter was modified by another user; reload and retry')
  })

  it('returns 503 when the upstream service is not configured', async () => {
    delete process.env.DEEDLY_API_BASE_URL
    try {
      const res = await httpPatch(
        `/api/v1/transfers/${TRANSFER_ID}`,
        { Authorization: `Bearer ${makeToken()}` },
        PATCH_BODY
      )
      assert.equal(res.status, 503)
    } finally {
      process.env.DEEDLY_API_BASE_URL = upstreamBaseUrl
    }
  })
})
