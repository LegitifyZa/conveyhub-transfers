import assert from 'node:assert/strict'
import { createServer, IncomingMessage, Server, ServerResponse, request as httpRequest } from 'node:http'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'

import jwt from 'jsonwebtoken'

// BFF document-lane proxy coverage: JSON creates, raw multipart file
// passthrough, download-link issuance, requirement recalculation, and the
// bearer-token download stream. The upstream FastAPI service is a local
// capture stub — this verifies the BFF contract, not upstream behavior.

process.env.VERCEL = '1'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-bytes-long!!'

const JWT_SECRET = process.env.JWT_SECRET

const { default: app } = await import('../index')
const { pool } = await import('../db')

interface CapturedRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: Buffer
}

let server: Server
let baseUrl: string
let upstream: Server
let captured: CapturedRequest[]
let upstreamResponse: { status: number; body: unknown; contentType?: string }

const TRANSFER_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '55555555-5555-4555-8555-555555555555'

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

async function postJson(path: string, headers: Record<string, string>, json?: unknown) {
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
  upstreamResponse = { status: 201, body: { message: 'Created', data: { id: DOC_ID } } }

  upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      captured.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      })
      const response = upstreamResponse
      if (response.contentType === 'application/pdf') {
        res.writeHead(response.status, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': "attachment; filename*=UTF-8''fica.pdf",
        }).end(response.body as Buffer)
        return
      }
      res
        .writeHead(response.status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(response.body))
    })
  })
  const upstreamBaseUrl = await listen(upstream)
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

describe('v1 document BFF proxies', async () => {
  beforeEach(() => {
    captured = []
    upstreamResponse = { status: 201, body: { message: 'Created', data: { id: DOC_ID } } }
  })

  it('returns 401 without a JWT and never calls upstream', async () => {
    const res = await postJson(`/api/v1/transfers/${TRANSFER_ID}/documents`, {}, { name: 'FICA' })
    assert.equal(res.status, 401)
    assert.equal(captured.length, 0)
  })

  it('proxies document creation with the caller JWT unchanged', async () => {
    const res = await postJson(
      `/api/v1/transfers/${TRANSFER_ID}/documents`,
      { Authorization: `Bearer ${makeToken()}` },
      { name: 'FICA', client_request_id: randomUUID() }
    )
    assert.equal(res.status, 201)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/documents`)
    assert.ok(String(captured[0].headers.authorization).startsWith('Bearer '))
  })

  it('proxies requirement recalculation', async () => {
    upstreamResponse = { status: 200, body: { message: 'OK', data: { requirements: [] } } }
    const res = await postJson(
      `/api/v1/transfers/${TRANSFER_ID}/documents/requirements/recalculate`,
      { Authorization: `Bearer ${makeToken()}` },
      {}
    )
    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/documents/requirements/recalculate`)
  })

  it('proxies download-link issuance', async () => {
    upstreamResponse = {
      status: 200,
      body: { message: 'OK', data: { downloadUrl: '/api/v1/documents/download/v1.x.y', expires: 1 } },
    }
    const res = await postJson(
      `/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/download-link`,
      { Authorization: `Bearer ${makeToken()}` },
      {}
    )
    assert.equal(res.status, 200)
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/download-link`)
  })

  it('forwards the raw multipart body and content type for file upload', async () => {
    upstreamResponse = { status: 200, body: { message: 'OK', data: { document: { id: DOC_ID }, outcome: 'uploaded' } } }
    const boundary = '----testboundary42'
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="fica.pdf"\r\n` +
        `Content-Type: application/pdf\r\n\r\n` +
        `%PDF-1.4 synthetic\r\n` +
        `--${boundary}--\r\n`
    )
    const res = await fetch(`${baseUrl}/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/file`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${makeToken()}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: payload,
    })
    assert.equal(res.status, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].url, `/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/file`)
    assert.match(String(captured[0].headers['content-type']), /multipart\/form-data/)
    // The bytes arrive unchanged — upstream sees the same multipart envelope.
    assert.deepEqual(captured[0].body, payload)
  })

  it('rejects a declared-oversize upload with 413 before proxying', async () => {
    // The BFF refuses a declared body over the 25 MB cap + multipart overhead
    // on headers alone — upstream is never reached and no bytes stream.
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${baseUrl}/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/file`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${makeToken()}`,
            'Content-Type': 'multipart/form-data; boundary=----x',
            'Content-Length': String(26 * 1024 * 1024),
          },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', () => resolve(0)) // socket may reset after early 413
      req.write('partial')
      // Never send the full declared body — the server must answer anyway.
      setTimeout(() => req.destroy(), 2000).unref()
    })
    assert.equal(status, 413)
    assert.equal(captured.length, 0)
  })

  it('streams the bearer-token download through without requiring a JWT', async () => {
    const bytes = Buffer.from('%PDF-1.4 download-bytes')
    upstreamResponse = { status: 200, body: bytes, contentType: 'application/pdf' }
    const res = await fetch(`${baseUrl}/api/v1/documents/download/v1.payload.sig`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'application/pdf')
    assert.equal(res.headers.get('content-disposition'), "attachment; filename*=UTF-8''fica.pdf")
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes)
    assert.equal(captured[0].url, '/api/v1/documents/download/v1.payload.sig')
  })

  it('maps upstream 5xx to a generic 503', async () => {
    upstreamResponse = { status: 502, body: { message: 'bad gateway' } }
    const res = await postJson(
      `/api/v1/transfers/${TRANSFER_ID}/documents`,
      { Authorization: `Bearer ${makeToken()}` },
      { name: 'FICA' }
    )
    assert.equal(res.status, 503)
    assert.equal(res.body.success, false)
  })
})
