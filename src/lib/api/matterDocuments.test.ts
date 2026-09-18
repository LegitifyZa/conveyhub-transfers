import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import {
  createMatterDocument,
  fetchMatterDocuments,
  issueDocumentDownloadLink,
  recalculateDocumentRequirements,
  uploadMatterDocumentFile,
} from './matterDocuments'
import { ApiRequestError } from './http'

const TRANSFER_ID = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '55555555-5555-4555-8555-555555555555'

function respond(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
}

afterEach(() => mock.restoreAll())

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
