import assert from 'node:assert/strict'
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'

import jwt from 'jsonwebtoken'

process.env.VERCEL = '1'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-bytes-long!!'

const JWT_SECRET = process.env.JWT_SECRET

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

const MATTER_ID = '33333333-3333-4333-8333-333333333333'
const REQUIREMENT_ID = '44444444-4444-4444-8444-444444444444'

function makeToken(abilities: string[] = ['api', 'transfers:read', 'transfers:write'], role = 3, ai = 10) {
  return jwt.sign(
    {
      type: 'access',
      user_id: 42,
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

before(async () => {
  captured = []
  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      captured.push({
        method: req.method || 'GET',
        url: req.url || '',
        headers: req.headers,
        body: raw,
      })
      const resp = upstreamResponse || { status: 200, body: { message: 'ok', data: {} } }
      res.writeHead(resp.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(resp.body))
    })
  })
  upstreamBaseUrl = await listen(upstream)
  process.env.DEEDLY_API_BASE_URL = upstreamBaseUrl

  const { default: app } = await import('../index')
  server = createServer(app)
  baseUrl = await listen(server)
})

after(async () => {
  if (server) await new Promise((r) => server.close(r))
  if (upstream) await new Promise((r) => upstream.close(r))
})

beforeEach(() => {
  captured = []
  upstreamResponse = null
})

describe('BFF Document Requirements Proxy', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements`)
    assert.equal(res.status, 401)
  })

  it('proxies GET /api/v1/matters/:matterId/document-requirements with Bearer token', async () => {
    const token = makeToken()
    upstreamResponse = {
      status: 200,
      body: { message: 'ok', data: { total_required: 5, satisfied: 2, requirements: [] } },
    }

    const res = await fetch(`${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    assert.equal(res.status, 200)
    const json = await res.json()
    assert.equal(json.data.total_required, 5)

    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'GET')
    assert.equal(captured[0].url, `/api/v1/matters/${MATTER_ID}/document-requirements`)
    assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
  })

  it('proxies POST /api/v1/matters/:matterId/document-requirements/evaluate', async () => {
    const token = makeToken()
    upstreamResponse = {
      status: 200,
      body: { message: 'Requirements evaluated successfully', data: { total_required: 8 } },
    }

    const res = await fetch(`${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements/evaluate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'POST')
    assert.equal(captured[0].url, `/api/v1/matters/${MATTER_ID}/document-requirements/evaluate`)
  })

  it('proxies POST /api/v1/matters/:matterId/document-requirements/adhoc with body', async () => {
    const token = makeToken()
    upstreamResponse = {
      status: 200,
      body: { message: 'Requirement added', data: { document_code: 'custom_doc' } },
    }

    const payload = { document_code: 'custom_doc', title: 'Special Undertaking', instructions: 'Signed by seller' }
    const res = await fetch(`${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements/adhoc`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].method, 'POST')
    assert.deepEqual(JSON.parse(captured[0].body), payload)
  })

  it('proxies review endpoint', async () => {
    const token = makeToken()
    upstreamResponse = {
      status: 200,
      body: { message: 'Review recorded', data: { approved: true, status: 'SATISFIED' } },
    }

    const res = await fetch(
      `${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements/${REQUIREMENT_ID}/review`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ approved: true }),
      }
    )

    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(
      captured[0].url,
      `/api/v1/matters/${MATTER_ID}/document-requirements/${REQUIREMENT_ID}/review`
    )
  })

  it('proxies download endpoint with audit control', async () => {
    const token = makeToken()
    upstreamResponse = {
      status: 200,
      body: {
        message: 'Download authorized',
        data: { requirement_id: REQUIREMENT_ID, file_path: '/storage/poa.pdf' },
      },
    }

    const res = await fetch(
      `${baseUrl}/api/v1/matters/${MATTER_ID}/document-requirements/${REQUIREMENT_ID}/download`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(
      captured[0].url,
      `/api/v1/matters/${MATTER_ID}/document-requirements/${REQUIREMENT_ID}/download`
    )
  })
})
