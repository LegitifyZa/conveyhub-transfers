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
