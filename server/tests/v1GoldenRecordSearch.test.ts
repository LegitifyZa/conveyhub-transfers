import assert from 'node:assert/strict'
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it, mock } from 'node:test'

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
let upstreamMode: 'normal' | 'broken-body' | 'stalled-headers' | 'stalled-body' = 'normal'

const personCandidate = {
  goldenRecordId: '4a472877-dc13-46fa-a827-6f1b18d073e3',
  entityType: 'person',
  name: 'Jane Example',
  idNumber: '9001010001081',
  email: 'jane@example.test',
}
const matchedResponse = { message: 'OK', data: { status: 'matched', entityType: 'person', record: personCandidate } }

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
  upstreamResponse = { status: 200, body: matchedResponse }

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
      if (upstreamMode === 'stalled-headers') return
      if (upstreamMode === 'stalled-body' || upstreamMode === 'broken-body') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9999' })
        res.flushHeaders()
        res.write('{"privateUpstreamData":')
        if (upstreamMode === 'broken-body') setTimeout(() => res.destroy(), 10)
        return
      }
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
  return { entity_type: 'person', query: '9001010001081' }
}

describe('Golden Record search BFF proxy', async () => {
  beforeEach(() => {
    captured = []
    upstreamMode = 'normal'
    upstreamResponse = { status: 200, body: matchedResponse }
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
        data: { status: 'matched', entityType: 'person', record: personCandidate },
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

  it('relays FastAPI validation and authorization responses', async () => {
    for (const upstreamStatus of [400, 401, 403, 422]) {
      upstreamResponse = { status: upstreamStatus, body: { detail: 'Request rejected' } }
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

  it('relays company matches, trust ambiguity and normalized not-found without changing metadata', async () => {
    const trust = {
      goldenRecordId: '72872e36-b8b0-46f9-8719-e4fc4a319626', entityType: 'trust',
      name: 'Example Trust', idNumber: null, email: null,
      registrationNo: 'IT123/2020', mastersOffice: 'Cape Town', isTrust: true,
    }
    for (const data of [
      { status: 'matched', entityType: 'company', record: { ...trust, entityType: 'company', name: 'Example Ltd', registrationNo: '2020/123456/07', mastersOffice: null, isTrust: false } },
      { status: 'ambiguous', entityType: 'trust', candidates: [trust, { ...trust, goldenRecordId: 'db0418e5-cfad-45e7-9435-53bf8fec56a4', mastersOffice: 'Pretoria' }] },
      { status: 'not_found', entityType: 'person' },
    ]) {
      upstreamResponse = { status: 200, body: { message: 'OK', data } }
      const request = { entity_type: data.entityType, query: 'Example' }
      const { status, body } = await httpPost('/api/v1/golden-records/search', { Authorization: `Bearer ${makeToken(3, 5)}` }, request)
      assert.equal(status, 200)
      assert.deepEqual(body, upstreamResponse.body)
      assert.deepEqual(JSON.parse(captured[captured.length - 1].body), request)
    }
  })

  it('maps a response-body failure to a safe 503 without returning partial upstream data', async () => {
    upstreamMode = 'broken-body'
    const { status, body } = await httpPost('/api/v1/golden-records/search', { Authorization: `Bearer ${makeToken(3, 5)}` }, searchBody())
    assert.equal(status, 503)
    assert.deepEqual(body, { success: false, error: 'Golden Record service unavailable' })
  })

  for (const mode of ['stalled-headers', 'stalled-body'] as const) {
    it(`uses a 35-second deadline including ${mode}`, async () => {
      const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
      const timeout = mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        assert.equal(milliseconds, 35_000)
        return nativeTimeout(100)
      })
      upstreamMode = mode
      try {
        const { status, body } = await httpPost('/api/v1/golden-records/search', { Authorization: `Bearer ${makeToken(3, 5)}` }, searchBody())
        assert.equal(status, 503)
        assert.deepEqual(body, { success: false, error: 'Golden Record service unavailable' })
        assert.equal(timeout.mock.callCount(), 1)
      } finally {
        timeout.mock.restore()
      }
    })
  }

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

const personDetails = { ...personCandidate, phone: '0210000000', address: '1 Test Road' }
const retrievalPath = `/api/v1/golden-records/${personCandidate.goldenRecordId}?entity_type=person`

async function httpRetrieve(path = retrievalPath, headers: Record<string, string> = { Authorization: `Bearer ${makeToken(3, 5)}` }) {
  const response = await fetch(`${baseUrl}${path}`, { headers })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

describe('Golden Record retrieval BFF proxy', () => {
  beforeEach(() => {
    captured = []
    upstreamMode = 'normal'
    upstreamResponse = { status: 200, body: { message: 'OK', data: personDetails } }
  })

  it('requires a valid user JWT and rejects service-key-only access before forwarding', async () => {
    const cases: Record<string, string>[] = [{}, { Authorization: 'Bearer invalid' }, { 'X-Service-Key': 'browser-key' }]
    for (const headers of cases) {
      assert.equal((await httpRetrieve(retrievalPath, headers)).status, 401)
    }
    assert.equal(captured.length, 0)
  })

  for (const kind of ['person', 'company', 'trust']) {
    it(`forwards an authenticated ${kind} GET without changing its logical type or details`, async () => {
      const path = `/api/v1/golden-records/${personCandidate.goldenRecordId}?entity_type=${kind}`
      const token = makeToken(3, 5)
      const data = kind === 'person' ? personDetails : {
        ...personDetails, entityType: kind, registrationNo: 'REG-1', isTrust: kind === 'trust',
        mastersOffice: kind === 'trust' ? 'cape_town' : null,
      }
      upstreamResponse = { status: 200, body: { message: 'OK', data } }
      const result = await httpRetrieve(path, { Authorization: `Bearer ${token}` })
      assert.equal(result.status, 200)
      assert.deepEqual(result.body, upstreamResponse.body)
      assert.equal(result.headers.get('cache-control'), 'no-store')
      assert.equal(captured.length, 1)
      assert.equal(captured[0].method, 'GET')
      assert.equal(captured[0].url, path)
      assert.equal(captured[0].headers.authorization, `Bearer ${token}`)
      assert.equal(captured[0].body, '')
    })
  }

  it('rejects malformed identifiers, types, repeated parameters and tenant overrides before forwarding', async () => {
    const root = `/api/v1/golden-records/${personCandidate.goldenRecordId}`
    for (const path of [
      '/api/v1/golden-records/PRIVATE-ID?entity_type=person',
      '/api/v1/golden-records/%2e%2e%2Ftransfers?entity_type=person',
      root, `${root}?entity_type=Trust`, `${root}?entity_type=person&entity_type=company`,
      `${root}?entity_type[override]=person`,
      ...['tenant_id', 'accountable_institution_id', 'actor', 'query'].map(field => `${root}?entity_type=person&${field}=PRIVATE-OVERRIDE`),
    ]) {
      const response = await httpRetrieve(path)
      assert.equal(response.status, 422)
      assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE/)
    }
    assert.equal(captured.length, 0)
  })

  it('forwards no service keys, tenant headers, cookies, or caller-controlled destination', async () => {
    const response = await httpRetrieve(retrievalPath, {
      Authorization: `Bearer ${makeToken(3, 5)}`, 'X-Service-Key': 'browser-key',
      'X-Accountable-Institution-Id': '999', 'X-Tenant-Id': 'other', Cookie: 'private-cookie',
      'X-Forwarded-Host': 'untrusted.invalid',
    })
    assert.equal(response.status, 200)
    for (const name of ['x-service-key', 'x-accountable-institution-id', 'x-tenant-id', 'cookie', 'x-forwarded-host']) {
      assert.equal(captured[0].headers[name], undefined)
    }
  })

  it('preserves safe FastAPI authorization, visibility and validation failures', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      upstreamResponse = { status, body: { success: false, error: 'Request rejected' } }
      const response = await httpRetrieve()
      assert.equal(response.status, status)
      assert.deepEqual(response.body, upstreamResponse.body)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  })

  it('sanitizes FastAPI failures rather than returning internal exception bodies', async () => {
    for (const status of [500, 502, 503, 504]) {
      upstreamResponse = { status, body: { privateUpstreamData: 'PRIVATE-STACK' } }
      const response = await httpRetrieve()
      assert.equal(response.status, 503)
      assert.deepEqual(response.body, { success: false, error: 'Golden Record service unavailable' })
    }
  })

  it('handles missing configuration without a fallback upstream', async () => {
    const saved = process.env.DEEDLY_API_BASE_URL
    delete process.env.DEEDLY_API_BASE_URL
    try {
      const response = await httpRetrieve()
      assert.equal(response.status, 503)
      assert.equal(captured.length, 0)
    } finally {
      process.env.DEEDLY_API_BASE_URL = saved
    }
  })

  it('maps a network failure to a safe 503', async () => {
    const saved = process.env.DEEDLY_API_BASE_URL
    process.env.DEEDLY_API_BASE_URL = 'http://127.0.0.1:1'
    try {
      const response = await httpRetrieve()
      assert.equal(response.status, 503)
      assert.deepEqual(response.body, { success: false, error: 'Golden Record service unavailable' })
    } finally {
      process.env.DEEDLY_API_BASE_URL = saved
    }
  })

  it('never forwards a partial broken response body', async () => {
    upstreamMode = 'broken-body'
    const response = await httpRetrieve()
    assert.equal(response.status, 503)
    assert.deepEqual(response.body, { success: false, error: 'Golden Record service unavailable' })
  })

  for (const mode of ['stalled-headers', 'stalled-body'] as const) {
    it(`bounds retrieval including ${mode} with the existing 35-second BFF deadline`, async () => {
      const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
      const timeout = mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        assert.equal(milliseconds, 35_000)
        return nativeTimeout(100)
      })
      upstreamMode = mode
      try {
        const response = await httpRetrieve()
        assert.equal(response.status, 503)
        assert.deepEqual(response.body, { success: false, error: 'Golden Record service unavailable' })
        assert.equal(timeout.mock.callCount(), 1)
      } finally {
        timeout.mock.restore()
      }
    })
  }
})
