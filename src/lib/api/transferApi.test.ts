import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { TransferApi } from './transferApi'
import { ApiRequestError } from './http'

// Concurrency tokens deliberately carry non-zero microseconds: the client
// must echo them byte-for-byte.
const T_TS = '2026-01-02T10:00:00.123456+00:00'
const M_TS = '2026-01-02T10:00:01.654321+00:00'
const TRANSFER_ID = '22222222-2222-4222-8222-222222222222'

const DETAIL = {
  id: TRANSFER_ID,
  transferId: 'TRF-TEST-1',
  propertyAddress: '12 Seed Street',
  purchasePrice: 1000000,
  status: 'in_progress',
  updatedAt: T_TS,
  matter: {
    id: '44444444-4444-4444-8444-444444444444',
    referenceNumber: 'TRF-TEST-1',
    title: 'Original title',
    firmReference: 'FRM-1',
    classificationCode: 'sale_private_treaty',
    status: 'in_progress',
    updatedAt: M_TS,
  },
}

function respond(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
}

afterEach(() => mock.restoreAll())

const CLASSIFICATION = {
  canonicalCode: 'transfer.private_treaty.not_applicable',
  subtype: 'private_treaty',
  displayLabel: 'Private Treaty',
  transferFrom: 'not_applicable',
  transferFromLabel: 'Not Applicable',
  requiresTransferFrom: true,
}

describe('canonical transfer classifications', () => {
  it('loads authenticated reference data without a hard-coded fallback', async () => {
    const fetchMock = respond({ message: 'OK', data: { classifications: [CLASSIFICATION] } })
    assert.deepEqual(await TransferApi.getClassifications(), [CLASSIFICATION])
    assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/v1/transfers/classifications')
  })

  it('keeps an empty catalogue empty and fails on service errors', async () => {
    respond({ message: 'OK', data: { classifications: [] } })
    assert.deepEqual(await TransferApi.getClassifications(), [])
    mock.restoreAll()
    respond({ error: 'Unavailable' }, 503)
    await assert.rejects(TransferApi.getClassifications(), ApiRequestError)
  })

  it('rejects malformed, duplicate, generic and development options', async () => {
    for (const data of [
      {},
      { classifications: 'invalid' },
      { classifications: [null] },
      { classifications: [{ ...CLASSIFICATION, displayLabel: undefined }] },
      { classifications: [{ ...CLASSIFICATION, transferFromLabel: null }] },
      { classifications: [{ ...CLASSIFICATION, canonicalCode: 'transfer.generic' }] },
      { classifications: [{ ...CLASSIFICATION, canonicalCode: 'development.subdivision' }] },
      { classifications: [CLASSIFICATION, CLASSIFICATION] },
    ]) {
      mock.restoreAll()
      respond({ message: 'OK', data })
      await assert.rejects(TransferApi.getClassifications(), /classification response/i)
    }
  })

  it('preserves canonical code and firm reference when reopening a matter', async () => {
    respond({ message: 'OK', data: { ...DETAIL, matter: { ...DETAIL.matter, classificationCode: CLASSIFICATION.canonicalCode } } })
    const response = await TransferApi.getTransfer(TRANSFER_ID)
    assert.equal(response.data?.classificationCode, CLASSIFICATION.canonicalCode)
    assert.equal(response.data?.firmReference, 'FRM-1')
  })

  it('keeps unclassified and unavailable historical codes unchanged', async () => {
    for (const code of [null, 'transfer.historical_classification']) {
      mock.restoreAll()
      respond({ message: 'OK', data: { ...DETAIL, matter: { ...DETAIL.matter, classificationCode: code } } })
      const response = await TransferApi.getTransfer(TRANSFER_ID)
      assert.equal(response.data?.classificationCode, code)
    }
  })

  it('sends the canonical code, not a display label, and preserves the request key', async () => {
    const fetchMock = respond({ message: 'Created', data: { id: TRANSFER_ID } }, 201)
    await TransferApi.createMatter({
      property_address: '12 Seed Street', purchase_price: 100,
      firm_reference: 'FRM-1', classification_code: CLASSIFICATION.canonicalCode,
      client_request_id: '66666666-6666-4666-8666-666666666666',
    })
    const [, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    const sent = JSON.parse(init.body as string)
    assert.equal(sent.classification_code, CLASSIFICATION.canonicalCode)
    assert.equal(sent.firm_reference, 'FRM-1')
    assert.equal(sent.client_request_id, '66666666-6666-4666-8666-666666666666')
  })
})

describe('matter core API boundary', () => {
  it('getMatterCore reads the v1 detail route', async () => {
    const fetchMock = respond({ message: 'OK', data: DETAIL })
    const response = await TransferApi.getMatterCore(TRANSFER_ID)
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}`)
    assert.equal(init.method ?? 'GET', 'GET')
    assert.equal(response.data?.matter?.firmReference, 'FRM-1')
  })

  it('updateMatterCore echoes both version tokens verbatim, microseconds intact', async () => {
    const fetchMock = respond({ message: 'OK', data: DETAIL })
    await TransferApi.updateMatterCore(TRANSFER_ID, {
      expected_updated_at: T_TS,
      expected_matter_updated_at: M_TS,
      property_address: '99 New Road',
      firm_reference: null,
    })
    const [url, init] = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit]
    assert.equal(url, `/api/v1/transfers/${TRANSFER_ID}`)
    assert.equal(init.method, 'PATCH')
    const sent = JSON.parse(init.body as string)
    assert.equal(sent.expected_updated_at, T_TS)
    assert.equal(sent.expected_matter_updated_at, M_TS)
    assert.equal(sent.firm_reference, null)
    assert.equal('purchase_price' in sent, false)
  })

  it('surfaces a 409 stale-version conflict as a typed error the UI can key on', async () => {
    respond({ success: false, error: 'Matter was modified by another user; reload and retry' }, 409)
    await assert.rejects(
      TransferApi.updateMatterCore(TRANSFER_ID, {
        expected_updated_at: T_TS,
        expected_matter_updated_at: M_TS,
        property_address: 'X',
      }),
      (error: unknown) => error instanceof ApiRequestError && error.status === 409
    )
  })

  it('never reports success on a failed save (503/500 surface as errors)', async () => {
    respond({ success: false, error: 'Matter service temporarily unavailable' }, 503)
    await assert.rejects(
      TransferApi.updateMatterCore(TRANSFER_ID, {
        expected_updated_at: T_TS,
        expected_matter_updated_at: M_TS,
        property_address: 'X',
      }),
      (error: unknown) => error instanceof ApiRequestError && error.status === 503
    )
  })
})
