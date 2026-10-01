import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  createMatterDocument,
  downloadMatterDocumentFile,
  downloadMatterDocument,
  isDownloadSessionCurrent,
  type DownloadSession,
  fetchMatterDocuments,
  issueDocumentDownloadLink,
  recalculateDocumentRequirements,
  uploadMatterDocumentFile,
} from './matterDocuments'
import { ApiRequestError } from './http'
import { clearSession, logoutSession, setSession } from './session'

const TRANSFER_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '55555555-5555-4555-8555-555555555555'

function respond(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  clearSession()
  mock.restoreAll()
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

function session(name: 'A' | 'B') {
  setSession({ sid: `synthetic-${name}`, principalKey: name.toLowerCase().repeat(64), accessToken: `synthetic-${name}`, expires: 9999999999, user: null })
}

function delayedBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), {
    headers: { 'Content-Type': 'application/pdf' },
  })
  return { response, release() { controller.enqueue(new TextEncoder().encode('%PDF-1.4 synthetic-A')); controller.close() } }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

describe('session-bound document body consumption', () => {
  for (const transition of ['switch', 'logout'] as const) {
    it(`never returns a delayed A blob after ${transition}`, async () => {
      session('A')
      const body = delayedBody()
      mock.method(globalThis, 'fetch', async (url: unknown) => String(url) === '/api/auth/logout' ? new Response('{}') : body.response)
      const pending = downloadMatterDocumentFile('/api/v1/documents/download/synthetic', 'synthetic.pdf')
      await tick()
      assert.equal(body.response.bodyUsed, true)
      if (transition === 'switch') session('B')
      else await logoutSession()
      const rejected = assert.rejects(pending, /session changed/i)
      body.release()
      await rejected
    })
  }

  it('returns same-session bytes and the server filename', async () => {
    session('A')
    mock.method(globalThis, 'fetch', async () => new Response('%PDF synthetic', {
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''synthetic%20file.pdf" },
    }))
    const result = await downloadMatterDocumentFile('/api/v1/documents/download/synthetic', 'fallback.pdf')
    assert.equal(await result.blob.text(), '%PDF synthetic')
    assert.equal(result.filename, 'synthetic file.pdf')
  })
})

function browserDownload(onCreate: () => void = () => {}, onClick: () => void = () => {}) {
  const anchor = { href: '', download: '', click: mock.fn(onClick) }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => anchor } })
  const create = mock.method(URL, 'createObjectURL', () => { onCreate(); return 'blob:synthetic-download' })
  const revoke = mock.method(URL, 'revokeObjectURL', () => {})
  return { anchor, create, revoke }
}

function downloadTransport(response: Response) {
  return mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).endsWith('/download-link')) return new Response(JSON.stringify({ message: 'OK', data: { downloadUrl: '/api/v1/documents/download/synthetic', expires: 9999999999 } }))
    if (String(url) === '/api/auth/logout') return new Response('{}')
    return response
  })
}

describe('complete browser download operation', () => {
  for (const transition of ['switch', 'logout'] as const) {
    it(`never triggers a browser download when the A body completes after ${transition}`, async () => {
      session('A')
      const effects = browserDownload()
      const body = delayedBody()
      downloadTransport(body.response)
      const scope: DownloadSession = {}
      const pending = downloadMatterDocument(TRANSFER_ID, DOC_ID, 'synthetic.pdf', scope)
      await tick()
      assert.equal(body.response.bodyUsed, true)
      if (transition === 'switch') session('B')
      else await logoutSession()
      const rejected = assert.rejects(pending, /session changed/i)
      body.release()
      await rejected
      assert.equal(isDownloadSessionCurrent(scope), false)
      assert.equal(effects.create.mock.callCount(), 0)
      assert.equal(effects.anchor.click.mock.callCount(), 0)
      assert.equal(effects.revoke.mock.callCount(), 0)
    })

    it(`rechecks immediately before clicking and revokes its URL on ${transition}`, async () => {
      session('A')
      const effects = browserDownload(() => transition === 'switch' ? session('B') : clearSession())
      downloadTransport(new Response('%PDF synthetic'))
      await assert.rejects(downloadMatterDocument(TRANSFER_ID, DOC_ID, 'synthetic.pdf'), /session changed/i)
      assert.equal(effects.create.mock.callCount(), 1)
      assert.equal(effects.anchor.click.mock.callCount(), 0)
      assert.deepEqual(effects.revoke.mock.calls[0].arguments, ['blob:synthetic-download'])
    })
  }

  it('keeps the originating scope between link acquisition and file retrieval', async () => {
    session('A')
    const transport = downloadTransport(new Response('%PDF synthetic'))
    const scope: DownloadSession = {}
    const link = await issueDocumentDownloadLink(TRANSFER_ID, DOC_ID, scope)
    session('B')
    await assert.rejects(downloadMatterDocumentFile(link.downloadUrl, 'synthetic.pdf', scope), /session changed/i)
    assert.equal(transport.mock.callCount(), 1, 'No file request may be sent under B')
  })

  it('does not retrieve a file when link issuance finishes after logout', async () => {
    session('A')
    const effects = browserDownload()
    let release!: (value: Response) => void
    const transport = mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { release = resolve }))
    const pending = downloadMatterDocument(TRANSFER_ID, DOC_ID, 'synthetic.pdf')
    clearSession()
    const rejected = assert.rejects(pending, /session changed/i)
    release(new Response(JSON.stringify({ data: { downloadUrl: '/api/v1/documents/download/synthetic', expires: 9999999999 } })))
    await rejected
    assert.equal(transport.mock.callCount(), 1)
    assert.equal(effects.create.mock.callCount(), 0)
    assert.equal(effects.anchor.click.mock.callCount(), 0)
  })

  it('downloads normally through a same-principal refresh and revokes the object URL', async () => {
    session('A')
    const effects = browserDownload()
    const body = delayedBody()
    downloadTransport(body.response)
    const pending = downloadMatterDocument(TRANSFER_ID, DOC_ID, 'synthetic.pdf')
    await tick()
    setSession({ sid: 'synthetic-A', principalKey: 'a'.repeat(64), accessToken: 'refreshed-A', expires: 9999999999, user: null })
    body.release()
    await pending
    assert.equal(effects.anchor.click.mock.callCount(), 1)
    assert.equal(effects.anchor.download, 'synthetic.pdf')
    assert.equal(effects.anchor.href, 'blob:synthetic-download')
    assert.deepEqual(effects.revoke.mock.calls[0].arguments, ['blob:synthetic-download'])
  })

  it('revokes its object URL even when triggering the browser download throws', async () => {
    session('A')
    const effects = browserDownload(() => {}, () => { throw new Error('Synthetic click failure') })
    downloadTransport(new Response('%PDF synthetic'))
    await assert.rejects(downloadMatterDocument(TRANSFER_ID, DOC_ID, 'synthetic.pdf'), /Synthetic click failure/)
    assert.equal(effects.anchor.click.mock.callCount(), 1)
    assert.deepEqual(effects.revoke.mock.calls[0].arguments, ['blob:synthetic-download'])
  })
})

describe('matter documents v1 API', () => {
  it('fetchMatterDocuments unwraps the {message, data} envelope', async () => {
    const fetchMock = respond({
      message: 'OK',
      data: {
        documents: [{ id: DOC_ID, name: 'FICA', status: 'pending', scanStatus: 'not_scanned' }],
        requirements: [{ id: 'r1', requirementKey: 'fica', displayName: 'FICA', source: 'baseline', status: 'active' }],
      },
    })
    const result = await fetchMatterDocuments(TRANSFER_ID)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}/documents`)
    assert.equal(init.method ?? 'GET', 'GET')
    assert.equal(result.documents.length, 1)
    assert.equal(result.requirements[0].requirementKey, 'fica')
    // Flags default to empty when the server omits them.
    assert.deepEqual(result.unevaluatedFacts, [])
    assert.deepEqual(result.unevaluatedRules, [])
  })

  it('createMatterDocument sends snake_case fields with client_request_id', async () => {
    const fetchMock = respond({ message: 'Created', data: { id: DOC_ID } }, 201)
    await createMatterDocument(TRANSFER_ID, {
      name: 'FICA',
      requirementKey: 'fica',
      clientRequestId: 'key-1',
    })
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}/documents`)
    const sent = JSON.parse(init.body as string)
    assert.equal(sent.name, 'FICA')
    assert.equal(sent.requirement_key, 'fica')
    assert.equal(sent.client_request_id, 'key-1')
    assert.equal(sent.status, undefined) // server-owned — never client-settable
  })

  it('uploadMatterDocumentFile sends a multipart file body', async () => {
    const fetchMock = respond({ message: 'OK', data: { document: { id: DOC_ID }, outcome: 'uploaded' } })
    const file = new File(['%PDF-1.4 x'], 'fica.pdf', { type: 'application/pdf' })
    const result = await uploadMatterDocumentFile(TRANSFER_ID, DOC_ID, file)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/file`)
    assert.equal(init.method, 'POST')
    assert.ok(init.body instanceof FormData)
    assert.ok((init.body as FormData).get('file') instanceof File)
    assert.equal(result.outcome, 'uploaded')
  })

  it('recalculateDocumentRequirements POSTs and returns requirements plus flags', async () => {
    const fetchMock = respond({
      message: 'OK',
      data: {
        requirements: [{ id: 'r1', requirementKey: 'fica', status: 'active' }],
        unevaluatedFacts: ['classification_code'],
        unevaluatedRules: [{ ruleKey: 'sale_addendum', conditionKey: null }],
      },
    })
    const result = await recalculateDocumentRequirements(TRANSFER_ID)
    const [url] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}/documents/requirements/recalculate`)
    assert.equal(result.requirements[0].status, 'active')
    assert.deepEqual(result.unevaluatedFacts, ['classification_code'])
    assert.equal(result.unevaluatedRules[0].ruleKey, 'sale_addendum')
  })

  it('issueDocumentDownloadLink returns the opaque URL and expiry', async () => {
    const fetchMock = respond({
      message: 'OK',
      data: { downloadUrl: '/api/v1/documents/download/v1.x.y', expires: 123 },
    })
    const result = await issueDocumentDownloadLink(TRANSFER_ID, DOC_ID)
    const [url] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}/documents/${DOC_ID}/download-link`)
    assert.equal(result.downloadUrl, '/api/v1/documents/download/v1.x.y')
    assert.equal(result.expires, 123)
  })

  it('surfaces failures — no swallowing into fake success', async () => {
    respond({ message: 'Forbidden' }, 403)
    await assert.rejects(() => fetchMatterDocuments(TRANSFER_ID), ApiRequestError)
    respond({ message: 'Not available', errors: ['Document is not available for download'] }, 409)
    await assert.rejects(() => issueDocumentDownloadLink(TRANSFER_ID, DOC_ID), ApiRequestError)
  })
})
