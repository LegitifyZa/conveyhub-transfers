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

function makeToken(role: number, ai: number, abilities: string[] = ['api', 'transfers:read']) {
  return jwt.sign(
    {
      type: 'access',
      user_id: 1,
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
  upstreamResponse = { status: 200, body: { message: 'OK', data: { status: 'matched' } } }

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

function searchBody() {
  return { entity_type: 'person', id_number: '9001010001081' }
}

describe('Golden Record search BFF proxy', async () => {
  beforeEach(() => {
    upstreamResponse = { status: 200, body: { message: 'OK', data: { status: 'matched' } } }
  })

  it('returns 401 when no JWT is supplied and never calls upstream', async () => {
    const { status } = await httpPost('/api/v1/golden-records/search', {}, searchBody())
    assert.equal(status, 401)
    assert.equal(captured.length, 0)
  })

  it('returns 401 for a malformed JWT and never calls upstream', async () => {
    const { status } = await httpPost(
      '/api/v1/golden-records/search',
      { Authorization: 'Bearer not-a-jwt' },
      searchBody()
    )
    assert.equal(status, 401)
    assert.equal(captured.length, 0)
  })

  it('forwards the Authorization header and body unchanged', async () => {
    const token = makeToken(3, 5)
    const body = searchBody()
    const { status } = await httpPost(
      '/api/v1/golden-records/search',
      { Authorization: `Bearer ${token}` },
      body
    )

    assert.equal(status, 200)
    assert.equal(captured.length, 1)
    const upstreamReq = captured[0]
    assert.equal(upstreamReq.method, 'POST')
    assert.equal(upstreamReq.url, '/api/v1/golden-records/search')
    assert.equal(upstreamReq.headers['authorization'], `Bearer ${token}`)
    assert.deepEqual(JSON.parse(upstreamReq.body), body)
  })

  it('relays a FastAPI 200 response', async () => {
    upstreamResponse = {
      status: 200,
      body: {
        message: 'OK',
        data: { status: 'matched', entityType: 'person', record: { goldenRecordId: 'abc' } },
      },
    }
    const { status, body } = await httpPost(
      '/api/v1/golden-records/search',
      { Authorization: `Bearer ${makeToken(3, 5)}` },
      searchBody()
    )
    assert.equal(status, 200)
    assert.deepEqual(body, upstreamResponse.body)
  })

  it('relays FastAPI 400 and 422 responses', async () => {
    for (const upstreamStatus of [400, 422]) {
      upstreamResponse = { status: upstreamStatus, body: { success: false, error: 'bad' } }
      const { status, body } = await httpPost(
        '/api/v1/golden-records/search',
        { Authorization: `Bearer ${makeToken(3, 5)}` },
        searchBody()
      )
      assert.equal(status, upstreamStatus)
      assert.deepEqual(body, upstreamResponse.body)
    }
  })

  it('relays a FastAPI 503 response', async () => {
    upstreamResponse = {
      status: 503,
      body: { success: false, error: 'Golden Record service unavailable' },
    }
    const { status, body } = await httpPost(
      '/api/v1/golden-records/search',
      { Authorization: `Bearer ${makeToken(3, 5)}` },
      searchBody()
    )
    assert.equal(status, 503)
    assert.deepEqual(body, upstreamResponse.body)
  })

  it('maps an upstream network failure to a safe 503', async () => {
    const saved = process.env.DEEDLY_API_BASE_URL
    // Nothing listens on port 1, so fetch rejects with a network error.
    process.env.DEEDLY_API_BASE_URL = 'http://127.0.0.1:1'
    try {
      const { status, body } = await httpPost(
        '/api/v1/golden-records/search',
        { Authorization: `Bearer ${makeToken(3, 5)}` },
        searchBody()
      )
      assert.equal(status, 503)
      assert.equal(body.success, false)
      assert.equal(body.error, 'Golden Record service unavailable')
    } finally {
      process.env.DEEDLY_API_BASE_URL = saved
    }
  })

  it('returns a safe 503 when DEEDLY_API_BASE_URL is unset', async () => {
    const saved = process.env.DEEDLY_API_BASE_URL
    delete process.env.DEEDLY_API_BASE_URL
    const capturedBefore = captured.length
    try {
      const { status, body } = await httpPost(
        '/api/v1/golden-records/search',
        { Authorization: `Bearer ${makeToken(3, 5)}` },
        searchBody()
      )
      assert.equal(status, 503)
      assert.equal(body.error, 'Golden Record service unavailable')
      assert.equal(captured.length, capturedBefore)
    } finally {
      process.env.DEEDLY_API_BASE_URL = saved
    }
  })

  it('adds no service key or tenant-override headers upstream', async () => {
    const { status } = await httpPost(
      '/api/v1/golden-records/search',
      {
        Authorization: `Bearer ${makeToken(3, 5)}`,
        'X-Service-Key': 'browser-must-never-set-this',
        'X-Accountable-Institution-Id': '999',
      },
      searchBody()
    )

    assert.equal(status, 200)
    const upstreamReq = captured[captured.length - 1]
    const headerNames = Object.keys(upstreamReq.headers).map((h) => h.toLowerCase())
    assert.ok(!headerNames.includes('x-service-key'))
    assert.ok(!headerNames.includes('x-accountable-institution-id'))
    assert.ok(!headerNames.includes('x-tenant-id'))
    // The body is forwarded as-is; Node adds nothing to it.
    assert.deepEqual(JSON.parse(upstreamReq.body), searchBody())
  })
})
