import assert from 'node:assert/strict'
import { describe, it, mock, beforeEach, afterEach } from 'node:test'
import { probeMatterPersistence } from './serviceStatus'

/**
 * Regression coverage for the envelope defect: the persistence probe used
 * to key on `response.success`, but the real v1 list endpoint returns
 * `{ message, data: { transfers, pagination } }` — no `success` field.
 * A healthy API therefore read as failure and disabled the wizard's
 * Save/Submit permanently. The probe must validate the actual contract
 * (a data.transfers array) and fail closed on malformed/error responses.
 */

function respond(body: unknown, status = 200) {
  return mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('probeMatterPersistence', () => {
  beforeEach(() => mock.restoreAll())
  afterEach(() => mock.restoreAll())

  it('accepts the real v1 { message, data: { transfers } } envelope', async () => {
    respond({ message: 'OK', data: { transfers: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } } })
    assert.equal(await probeMatterPersistence(), null)
  })

  it('accepts a non-empty transfers array', async () => {
    respond({ message: 'OK', data: { transfers: [{ id: 't-1' }] } })
    assert.equal(await probeMatterPersistence(), null)
  })

  it('fails closed on a legacy { success: true } envelope without data.transfers', async () => {
    // The old check would have passed this; the corrected one must not —
    // a body without the v1 list payload is not proof the lane is up.
    respond({ success: true })
    assert.ok(await probeMatterPersistence() instanceof Error)
  })

  it('fails closed when data is present but transfers is not an array', async () => {
    for (const body of [
      { message: 'OK', data: {} },
      { message: 'OK', data: { transfers: 'not-an-array' } },
      { message: 'OK', data: null },
      { message: 'OK' },
      [],
      'ok',
    ]) {
      respond(body)
      assert.ok(await probeMatterPersistence() instanceof Error, JSON.stringify(body))
    }
  })

  it('fails closed on error envelopes and HTTP errors', async () => {
    respond({ success: false, error: 'Forbidden' }, 403)
    assert.ok(await probeMatterPersistence() instanceof Error)

    respond({ message: 'Internal error' }, 500)
    assert.ok(await probeMatterPersistence() instanceof Error)

    mock.method(globalThis, 'fetch', async () => Promise.reject(new TypeError('fetch failed')))
    assert.ok(await probeMatterPersistence() instanceof Error)
  })
})
